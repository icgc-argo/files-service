import Ajv, { JSONSchemaType, ErrorObject, DefinedError } from 'ajv';

import { fileFilterSchema } from './FileFilter';
import { EmbargoStage } from '../../data/files';
import { ClinicalExemption } from '../../data/files/file.model';

const ajv = new Ajv();

// The error type is copied from the .errors object of any of the validators.
type ValidationMethod<T> = (value: any) => T;

function createParamValidator<T>(schema: JSONSchemaType<T, false>): ValidationMethod<T> {
  const paramValidator = ajv.compile<T>(schema);
  return (value: any) => {
    if (paramValidator(value)) {
      return value as T;
    } else {
      throw new Error(JSON.stringify(paramValidator.errors));
    }
  };
}

const embargoStageValidator = (value: any): EmbargoStage => {
  if (!Object.values(EmbargoStage).includes(value)) {
    throw new Error(JSON.stringify({ message: `Invalid embargo stage: ${value}` }));
  }
  return value as EmbargoStage;
};

const clinicalExemptionValidator = (value: any): ClinicalExemption => {
  if (!Object.values(ClinicalExemption).includes(value)) {
    throw new Error(JSON.stringify({ message: `Invalid clinical exemption reason: ${value}` }));
  }
  return value as ClinicalExemption;
};

const validator = {
  clinicalExemption: clinicalExemptionValidator,
  embargoStage: embargoStageValidator,
  fileFilter: createParamValidator(fileFilterSchema),
};
export default validator;
