export type PendingActionKind = 'join' | 'remove' | 'start';
export type PendingActionPhase = 'signing' | 'pending' | 'confirmed' | 'timeout';
export type PendingActionGoal = 'key-added' | 'key-removed' | 'membership' | 'reward-share';
export type PendingAction = {
  goal?: PendingActionGoal;
  kind: PendingActionKind;
  phase: PendingActionPhase;
  signature?: string;
  submittedAt: number;
  targetAddress?: string;
  targetPublicKey?: string;
};

export function beginPendingAction(
  kind: PendingActionKind,
  target: Pick<PendingAction, 'targetAddress' | 'targetPublicKey'> = {},
  submittedAt = Date.now(),
): PendingAction {
  return { kind, phase: 'signing', submittedAt, ...target };
}

export function markPending(
  action: PendingAction,
  result: Pick<PendingAction, 'goal' | 'signature'>,
): PendingAction {
  return { ...action, ...result, phase: 'pending', submittedAt: Date.now() };
}

export function transitionPending(action: PendingAction, submittedAt: number, phase: Extract<PendingActionPhase, 'confirmed' | 'timeout'>): PendingAction | null { return action.submittedAt === submittedAt ? { ...action, phase } : null; }
export function isTimedOut(action: PendingAction, now = Date.now()) { return now - action.submittedAt >= 600_000; }
