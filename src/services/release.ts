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
import logger from '../logger';

function toFileId(file: File) {
  return file.objectId;
}

export async function calculateRelease(): Promise<Release> {
  /**
   * Get files that are currently public, and those queued for public release
   * Add these to the active release. Release service handles creating new release if active release not available.
   */
  const publicFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.PUBLIC,
  });
  const queuedFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.QUEUED,
  });
  const kept = publicFiles.map(toFileId);
  const added = queuedFiles.map(toFileId);

  const release = releaseService.updateActiveRelease({
    kept,
    added,
    removed: [], //TODO: Implement removed files after we build a "withdraw" mechanism for files.
  });

  return release;
}
