/*
 * Copyright (c) 2020 The Ontario Institute for Cancer Research. All rights reserved
 *
 * This program and the accompanying materials are made available under the terms of
 * the GNU Affero General Public License v3.0. You should have received a copy of the
 * GNU Affero General Public License along with this program.
 *  If not, see <http://www.gnu.org/licenses/>.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
 * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { createHash } from 'crypto';

import { FilterQuery } from 'mongodb';
import mongoose from 'mongoose';

export enum ReleaseState {
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
  PUBLISHED = 'PUBLISHED',
}

export interface Release {
  _id: string;
  version: string;
  state: ReleaseState;

  calculatedAt: Date;
  filesKept: string[];
  filesAdded: string[];
  filesRemoved: string[];

  publishedAt: Date;
  indices: string[];
  label: string;
  snapshot: string;
}

interface DbRelease {
  version: string;
  state: string;

  calculatedAt: Date;
  filesKept: string[];
  filesAdded: string[];
  filesRemoved: string[];

  publishedAt: Date;
  indices: string[];
  label: string;
  snapshot: string;
}

const ReleaseSchema = new mongoose.Schema(
  {
    version: { type: String, required: true },
    state: {
      type: String,
      required: true,
      enum: Object.values(ReleaseState),
      default: ReleaseState.ACTIVE,
    },

    calculatedAt: { type: Date, required: true },
    filesKept: { type: [String], required: true },
    filesAdded: { type: [String], required: true },
    filesRemoved: { type: [String], required: true },

    publishedAt: { type: Date, required: false },
    label: { type: String, required: false, unique: true, trim: true, sparse: true },
    indices: { type: [String], required: false },
    snapshot: { type: String, required: false },
  },
  { timestamps: true, minimize: false, optimisticConcurrency: true } as any, // optimistic concurrency is not defined in the types yet
);

export type ReleaseMongooseDocument = mongoose.Document & DbRelease;

const ReleaseModel = mongoose.model<ReleaseMongooseDocument>('Release', ReleaseSchema);

export type ReleaseFilesInput = {
  kept: string[];
  added: string[];
  removed: string[];
};

export type ReleaseUpdates = {
  files?: ReleaseFilesInput;
  label?: string;
  indices?: string[];
  publishedAt?: Date;
  state?: ReleaseState;
  snapshot?: string;
};

export async function create(files: ReleaseFilesInput): Promise<ReleaseMongooseDocument> {
  const version = calculateVersion(files);
  const release = new ReleaseModel({
    filesKept: files.kept,
    filesAdded: files.added,
    filesRemoved: files.removed,
    version,
    calculatedAt: new Date(),
  });
  return await release.save();
}

export async function getRelease(
  filter: FilterQuery<ReleaseMongooseDocument>,
): Promise<ReleaseMongooseDocument> {
  return (await ReleaseModel.findOne(filter)) as ReleaseMongooseDocument;
}

export async function getReleases(): Promise<ReleaseMongooseDocument[]> {
  return (await ReleaseModel.find({}).exec()) as ReleaseMongooseDocument[];
}

export async function updateRelease(
  release: Release,
  updates: ReleaseUpdates,
): Promise<ReleaseMongooseDocument> {
  const updatedRelease: Release = {
    ...release,
  };
  if (updates.files) {
    updatedRelease.filesKept = updates.files.kept;
    updatedRelease.filesAdded = updates.files.added;
    updatedRelease.filesRemoved = updates.files.removed;
    updatedRelease.version = calculateVersion(updates.files);
  }
  if (updates.label) {
    updatedRelease.label = updates.label;
  }
  if (updates.snapshot) {
    updatedRelease.snapshot = updates.snapshot;
  }
  if (updates.indices) {
    updatedRelease.indices = updates.indices;
  }
  if (updates.state) {
    updatedRelease.state = updates.state;
  }
  if (updates.publishedAt) {
    updatedRelease.publishedAt = updates.publishedAt;
  }
  return (await ReleaseModel.findOneAndUpdate({ _id: release._id }, updatedRelease, {
    new: true,
  })) as ReleaseMongooseDocument;
}

function calculateVersion(files: ReleaseFilesInput): string {
  const sortedKept = files.kept.sort();
  const sortedAdded = files.added.sort();
  const sortedRemoved = files.removed.sort();
  const versionInput = sortedKept
    .concat(sortedAdded)
    .concat(sortedRemoved)
    .join('');
  return createHash('md5')
    .update(versionInput)
    .digest('hex');
}
