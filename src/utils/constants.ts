import { Values } from '../types/utilityTypes';

export const SongAnalysisStates = {
	PUBLISHED: 'PUBLISHED',
	UNPUBLISHED: 'UNPUBLISHED',
	SUPPRESSED: 'SUPPRESSED',
} as const;
export type SongAnalysisState = Values<typeof SongAnalysisStates>;
