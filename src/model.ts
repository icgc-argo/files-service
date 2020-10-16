import mongoose from 'mongoose';
import { File, QueryFilters } from './entity';
const AutoIncrement = require('mongoose-sequence')(mongoose);

export async function getFiles(filters: QueryFilters) {
  return (await FileModel.find(buildQueryFilters(filters)).exec()) as FileDocument[];
}

export async function getFileRecordById(id: number) {
  return await FileModel.findOne({ fileId: id });
}

export async function getFileRecordByObjId(objId: string) {
  return await FileModel.findOne({
    objectId: objId,
  });
}

export async function create(file: File) {
  const newFile = new FileModel(file);
  const createdFile = await newFile.save();
  return createdFile;
}

export async function update(toUpdate: FileDocument) {
  const updatedFile = await toUpdate.save();
  return updatedFile;
}

const LabelSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: [String], required: false },
  },
  {
    _id: false,
  },
);

const FileSchema = new mongoose.Schema(
  {
    fileId: { type: Number, index: true, unique: true },
    objectId: { type: String, required: true, unique: true },
    repoId: { type: String, required: true },
    analysisId: { type: String, required: true },
    programId: { type: String, required: true },
    labels: [LabelSchema],
  },
  { timestamps: true, minimize: false, optimisticConcurrency: true } as any, // optimistic concurrency is not defined in the types yet
);

FileSchema.plugin(AutoIncrement, {
  inc_field: 'fileId',
});

export type FileDocument = mongoose.Document & File;

export let FileModel = mongoose.model<FileDocument>('File', FileSchema);

export const toPojo = (doc: mongoose.Document) => {
  const pojo = doc.toObject();
  if (pojo._id) {
    pojo._id = pojo._id.toString();
  }
  return pojo;
};

function buildQueryFilters(filters: QueryFilters) {
  const queryFilters: mongoose.MongooseFilterQuery<FileDocument> = {};
  if (filters.analysisId && filters.analysisId.length > 0) {
    queryFilters.analysisId = {
      $in: filters.analysisId,
    };
  }
  if (filters.programId && filters.programId.length > 0) {
    queryFilters.programId = {
      $in: filters.programId,
    };
  }
  if (filters.objectId && filters.objectId.length > 0) {
    queryFilters.objectId = {
      $in: filters.objectId,
    };
  }
  return queryFilters;
}
