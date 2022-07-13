import { isObjectLike, isString, isArray } from 'lodash';

export function isClinicalUpdateEvent(input: any): input is ClinicalUpdateEvent {
  return (
    isObjectLike(input) &&
    isString(input.programId) &&
    // donorIds is undefined or an array with all strings
    (input.donorIds === undefined || (isArray(input.donorIds) && (input.donorIds as any[]).every(i => isString(i))))
  );
}

type ClinicalUpdateEvent = {
  programId: string;
  donorIds?: string[];
};

export default ClinicalUpdateEvent;
