import { SongAnalysis } from '../../song';

import { isObjectLike, isString } from 'lodash';

export function isSongAnalysis(input: any): input is SongAnalysis {
  return isObjectLike(input) && isString(input.analysisId) && isString(input.analysisState);
}
