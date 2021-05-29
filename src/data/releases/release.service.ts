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

import { Release, ReleaseState, ReleaseMongooseDocument, ReleaseFilesInput } from './release.model';
import * as releaseModel from './release.model';
import logger from '../../logger';

export async function getReleases(): Promise<Release[]> {
  return (await releaseModel.getReleases()).map(toPojo);
}

export async function getActiveRelease(): Promise<Release | undefined> {
  const release = await releaseModel.getRelease({ state: ReleaseState.ACTIVE });
  if (release) {
    return toPojo(release);
  }

  return undefined;
}

export async function updateActiveReleaseFiles(files: ReleaseFilesInput): Promise<Release> {
  const activeRelease = await getActiveRelease();
  if (activeRelease) {
    return toPojo(await releaseModel.updateRelease(activeRelease, { files }));
  }
  return toPojo(await releaseModel.create(files));
}

export async function updateActiveReleaseIndices(indices: string[]): Promise<Release> {
  const activeRelease = await getActiveRelease();
  if (!activeRelease) {
    throw new Error('No active release.');
  }
  return toPojo(await releaseModel.updateRelease(activeRelease, { indices }));
}
export async function updateActiveReleaseLabel(label: string): Promise<Release> {
  const activeRelease = await getActiveRelease();
  if (!activeRelease) {
    throw new Error('No active release.');
  }
  return toPojo(await releaseModel.updateRelease(activeRelease, { label }));
}

function toPojo(releaseDoc: ReleaseMongooseDocument): Release {
  if (!releaseDoc) {
    throw new Error('cannot convert undefined');
  }
  return {
    _id: releaseDoc._id,
    label: releaseDoc.label,
    version: releaseDoc.version,
    state: releaseDoc.state as ReleaseState,
    calculatedAt: releaseDoc.calculatedAt,
    publishedAt: releaseDoc.publishedAt,
    indices: releaseDoc.indices,
    filesKept: releaseDoc.filesKept,
    filesAdded: releaseDoc.filesAdded,
    filesRemoved: releaseDoc.filesRemoved,
  };
}
