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

import { File, FileReleaseState, EmbargoStage } from '../data/files';
import * as fileService from '../data/files';
import { Release } from '../data/releases';
import * as releaseService from '../data/releases';
import StringMap from '../utils/StringMap';
import { getIndexer } from './indexer';
import getRollcall, { Index } from '../external/rollcall';
import logger from '../logger';

function toFileId(file: File) {
  return file.objectId;
}

export async function calculateRelease(): Promise<Release> {
  // Get files that are currently public, and those queued for public release
  // Add these to the active release. Release service handles creating new release if active release not available.

  const publicFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.PUBLIC,
  });
  const queuedFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.QUEUED,
  });
  const kept = publicFiles.map(toFileId);
  const added = queuedFiles.map(toFileId);

  const release = releaseService.updateActiveReleaseFiles({
    kept,
    added,
    removed: [], // TODO: Implement removed files after we build a "withdraw" mechanism for files.
  });

  return release;
}

/**
 * Build public indices for a release and save as snapshot.
 * This does:
 *  - Create the new public indices, adding and removing the files as required
 *  - TODO: Update from song (and clincial eventually) all files kept and added in the release
 *  - TODO: Snapshot the new indices in ES
 * This does not:
 *  - Alias the new indices (no change to the live platform data)
 *  - Update the embargoStage or releaseState of any files
 *  - Remove files from the restricted indices
 *
 * @param release
 */
export async function buildActiveRelease(label: string): Promise<Release> {
  let release = await releaseService.getActiveRelease();
  if (!release) {
    throw new Error('No Active release available.');
  }

  release = await releaseService.updateActiveReleaseLabel(label);

  // 1. Sort files into programs, published and restricted

  const programs: StringMap<{ kept: File[]; added: File[] }> = {};
  const filesKept: File[] = await fileService.getFilesFromObjectIds(release.filesKept);
  const filesAdded: File[] = await fileService.getFilesFromObjectIds(release.filesAdded);
  const filesRemoved: File[] = await fileService.getFilesFromObjectIds(release.filesRemoved);

  const programIds = new Set<string>();
  filesKept.forEach(file => programIds.add(file.programId));
  filesAdded.forEach(file => programIds.add(file.programId));
  filesRemoved.forEach(file => programIds.add(file.programId));

  filesKept.forEach(file => {
    const program = file.programId;
    if (!programs[program]) {
      programs[program] = { kept: [], added: [] };
    }
    programs[program].kept.push(file);
  });
  filesAdded.forEach(file => {
    const program = file.programId;
    if (!programs[program]) {
      programs[program] = { kept: [], added: [] };
    }
    programs[program].added.push(file);
  });

  // 2. Create public indices for each program (no clone!)
  const indexer = await getIndexer();

  // 2.a If the release already has public indices, remove those so we can build from the existing indices.
  await indexer.deleteIndices(release.indices);
  release = await releaseService.updateActiveReleaseIndices([]);

  // 2.b Clone new public indices from the current public indices.
  const publicIndices = await indexer.preparePublicIndices(Array.from(programIds));
  release = await releaseService.updateActiveReleaseIndices(publicIndices);

  // 3. Perform reindex of required documents from source indices to new published indices.

  await indexer.copyFilesToPublic(filesAdded);
  await indexer.removeFilesFromPublic(filesRemoved);

  return release;
}
