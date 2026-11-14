import { useState, useEffect } from 'react';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { RoleReveal } from './components/RoleReveal';
import { ClueTurn } from './components/ClueTurn';
import { Discussion } from './components/Discussion';
import { VotingBallot } from './components/VotingBallot';
import { ImposterFinalGuess } from './components/ImposterFinalGuess';
import { RoundResult } from './components/RoundResult';
import { supabase } from './lib/supabaseClient';
import type { RoomJoinResult } from './lib/roomService';
import { FIXED_ROUND_CHOICES } from './game/settings';
import type { FixedRoundCount, PublicPlayer } from './game/types';
import type { Phase } from './game/stateMachine';

type ActiveSession = RoomJoinResult & { nickname: string };

function getFixedRoundLimit(settings: unknown): FixedRoundCount {
  if (typeof settings !== 'object' || settings === null || !('fixedRounds' in settings)) {
    return 1;
  }

  return FIXED_ROUND_CHOICES.find((rounds) => rounds === settings.fixedRounds) ?? 1;
}

interface RoundState {
  roundId: string;
  roundNumber: number;
}

export function App() {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [currentRound, setCurrentRound] = useState<RoundState | null>(null);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [roundLimit, setRoundLimit] = useState<FixedRoundCount>(1);

  // Keep players in sync for ClueTurn and Discussion displays
  useEffect(() => {
    if (!session) return;

    async function loadPlayers() {
      const { data } = await supabase
        .from('players')
        .select('id, nickname, is_host, connection, score, joined_at, is_eliminated')
        .eq('room_id', session!.roomId)
        .is('removed_at', null)
        .order('joined_at', { ascending: true });

      if (data) {
        setPlayers(
          data.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            isHost: p.is_host,
            connection: p.connection,
            score: p.score,
            joinedAt: p.joined_at,
            hasLockedVote: false,
            isEliminated: p.is_eliminated,
          })),
        );
      }
    }

    loadPlayers();

    const channel = supabase
      .channel(`app:players:${session.roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${session.roomId}` },
        () => loadPlayers(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Realtime room listener at App level so both screens stay synchronized
  useEffect(() => {
    if (!session) return;

    // Check current phase on load
    async function checkCurrentState() {
      const { data } = await supabase
        .from('rooms')
        .select('phase, current_round_id, round_number, settings')
        .eq('id', session!.roomId)
        .maybeSingle();

      if (data) {
        setRoundLimit(getFixedRoundLimit(data.settings));
        if (data.current_round_id) {
          setCurrentRound({
            roundId: data.current_round_id,
            roundNumber: data.round_number,
          });
        }
        setPhase(data.phase as Phase);
      }
    }

    checkCurrentState();

    const channel = supabase
      .channel(`app:room:${session.roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${session.roomId}` },
        (payload) => {
          const updated = payload.new as {
            phase: Phase;
            current_round_id: string | null;
            round_number: number;
            settings: unknown;
          };

          setRoundLimit(getFixedRoundLimit(updated.settings));
          if (updated.current_round_id) {
            setCurrentRound({
              roundId: updated.current_round_id,
              roundNumber: updated.round_number,
            });
          }
          setPhase(updated.phase);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  if (!session) {
    return <Home onRoomJoined={(joined) => setSession(joined)} />;
  }

  if (phase === 'private_role_reveal' && currentRound) {
    return (
      <RoleReveal
        roundId={currentRound.roundId}
        playerId={session.playerId}
        roundNumber={currentRound.roundNumber}
        onAllAcknowledged={() => setPhase('clue_turn')}
      />
    );
  }

  if (phase === 'clue_turn' && currentRound) {
    return (
      <ClueTurn
        roomId={session.roomId}
        roundId={currentRound.roundId}
        playerId={session.playerId}
        isHost={session.isHost}
        players={players}
      />
    );
  }

  if (phase === 'discussion' && currentRound) {
    return (
      <Discussion
        roomId={session.roomId}
        isHost={session.isHost}
        players={players}
      />
    );
  }

  if ((phase === 'voting' || phase === 'tied_revote') && currentRound) {
    return (
      <VotingBallot
        roundId={currentRound.roundId}
        playerId={session.playerId}
        isRevote={phase === 'tied_revote'}
        players={players}
        allowNoImposter={players.length === 2}
      />
    );
  }

  if (phase === 'imposter_final_guess' && currentRound) {
    return (
      <ImposterFinalGuess
        roundId={currentRound.roundId}
        isHost={session.isHost}
        playerId={session.playerId}
        players={players}
      />
    );
  }

  if ((phase === 'round_result' || phase === 'scoreboard') && currentRound) {
    return (
      <RoundResult
        roomId={session.roomId}
        roundId={currentRound.roundId}
        roundNumber={currentRound.roundNumber}
        roundLimit={roundLimit}
        isHost={session.isHost}
        players={players}
        onPlayAgain={() => {
          setCurrentRound(null);
          setPhase('lobby');
        }}
      />
    );
  }

  return (
    <Lobby
      roomId={session.roomId}
      playerId={session.playerId}
      roomCode={session.code}
      isHost={session.isHost}
      nickname={session.nickname}
      onMatchStarted={(roundId, roundNumber) => {
        setCurrentRound({ roundId, roundNumber });
        setPhase('private_role_reveal');
      }}
      onLeave={() => {
        setSession(null);
        setCurrentRound(null);
        setPhase('lobby');
      }}
    />
  );
}
