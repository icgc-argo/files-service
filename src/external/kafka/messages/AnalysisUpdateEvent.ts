import { SongAnalysis } from '../../song';
import { isObjectLike, isString } from 'lodash';
import { isSongAnalysis } from './SongAnalysis';

export function isAnalysisUpdateEvent(input: any): input is AnalysisUpdateEvent {
  return (
    isObjectLike(input) &&
    isString(input.analysisId) &&
    isString(input.studyId) &&
    isString(input.state) &&
    isString(input.action) &&
    isString(input.songServerId) &&
    isSongAnalysis(input.analysis)
  );
}

type AnalysisUpdateEvent = {
  analysisId: string;
  studyId: string;
  state: string; // PUBLISHED, UNPUBLISHED, SUPPRESSED -> maybe more in the future so leaving this as string
  action: string; // PUBLISH, UNPUBLISH, SUPPRESS, CREATE -> future might add UPDATED
  songServerId: string;
  analysis: SongAnalysis;
};

export default AnalysisUpdateEvent;
