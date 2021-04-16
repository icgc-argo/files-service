import { JSONSchemaType } from 'ajv';

import { FileFilter, FileFilterProperties } from '../../data/files';

export const filePropertiesFilterSchema: JSONSchemaType<FileFilterProperties> = {
  type: 'object',
  required: [],
  properties: {
    analyses: {
      type: 'array',
      items: {
        type: 'string',
      },
      nullable: true,
      uniqueItems: true,
    },
    donors: {
      type: 'array',
      items: {
        type: 'string',
      },
      nullable: true,
      uniqueItems: true,
    },
    programs: {
      type: 'array',
      items: {
        type: 'string',
      },
      nullable: true,
      uniqueItems: true,
    },
    fileIds: {
      type: 'array',
      items: {
        type: 'string',
      },
      nullable: true,
      uniqueItems: true,
    },
    objectIds: {
      type: 'array',
      items: {
        type: 'string',
      },
      nullable: true,
      uniqueItems: true,
    },
  },
  additionalProperties: false,
};

export const fileFilterSchema: JSONSchemaType<FileFilter> = {
  type: 'object',
  required: [],
  properties: {
    include: { ...filePropertiesFilterSchema, nullable: true },
    exclude: { ...filePropertiesFilterSchema, nullable: true },
  },
  additionalProperties: false,
};

export function validateFileFilter(fileFilter: any): boolean {
  return true;
}
