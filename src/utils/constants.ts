import { Values } from '../types/utilityTypes';

export const SongAnalysisStates = {
	PUBLISHED: 'PUBLISHED',
	UNPUBLISHED: 'UNPUBLISHED',
	SUPPRESSED: 'SUPPRESSED',
};
export type SongAnalysisState = Values<typeof SongAnalysisStates>;
