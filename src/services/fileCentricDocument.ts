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

import logger from '../logger';
import { File } from '../data/files';
import { EmbargoStage, ReleaseState } from '../data/files';
import { FilePartialDocument } from '../external/analysisConverter';

export type FileCentricDocument = FilePartialDocument & {
  embargoStage: EmbargoStage;
  releaseState: ReleaseState;
};

type SearchDocumentInputs = {
  dbFile: File;
  filePartialDocument: FilePartialDocument;
};
export const buildDocument = ({
  dbFile,
  filePartialDocument,
}: SearchDocumentInputs): FileCentricDocument => {
  // Confirm we have only a single donor
  if (filePartialDocument.donors.length > 1) {
    logger.warn(
      `FilePartialDocument ${filePartialDocument.fileId} from analysis ${
        filePartialDocument.analysis.analysisId
      } has more than 1 donor: ${filePartialDocument.donors.map(
        (donor: { donorId: string }) => donor.donorId,
      )}`,
    );
  }
  if (!filePartialDocument.donors || filePartialDocument.donors.length < 1) {
    logger.error(`File ${filePartialDocument.fileId} has no associated donors`);
    throw new Error(
      'FileCentricDocument has no donors, it cannot be converted to a FileCentricDocument.',
    );
  }

  // Confirm the file has a fileId
  if (!dbFile.fileId) {
    logger.error(``);
    throw new Error('File record has no fileId, it cannot be converted to a FileCentricDocument.');
  }

  /**
   * Validations done. Work begins:
   */

  const output: FileCentricDocument = {
    ...filePartialDocument,
    fileId: dbFile.fileId,
    embargoStage: dbFile.embargoStage,
    releaseState: dbFile.releaseState,
  };

  return output;
};

export const buildDocuments = (inputs: SearchDocumentInputs[]): FileCentricDocument[] =>
  inputs.map(buildDocument);
