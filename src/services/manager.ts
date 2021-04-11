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

import { convertAnalysisToFileDocuments, FileCentricDocument } from '../external/analysisConverter';

import * as indexer from './indexer';
import * as fileService from '../data/files';
import { File, EmbargoStage, ReleaseState } from '../data/files';

/**
 * Index Analysis Steps:
 * 1. Convert all Analyses to FileCentricDocuments
 * 2. For each FileCentricDocument:
 *    - Save to DB
 *    - Update File document with FileID
 * 3. Send updated FileCentricDocuments to indexer
 * @param analyses
 * @param dataCenterId
 * @returns
 */
export async function indexAnalyses(analyses: any[], dataCenterId: string) {
  // get genomic files for analyses
  const files = await convertAnalysisToFileDocuments(analyses, dataCenterId);

  const docsWithFile = files.map(async f => {
    // Confirm we have only a single donor
    if (f.donors.length > 1) {
      logger.warn(
        `File ${f.fileId} from analysis ${
          f.analysis.analysisId
        } has more than 1 donor: ${f.donors.map((donor: { donorId: string }) => donor.donorId)}`,
      );
    }
    if (!f.donors || f.donors.length < 1) {
      logger.error(`File ${f.fileId} has no associated donors`);
      throw new Error('FileCentricDocument has no donors, it cannot be converted to a File.');
    }

    const fileToCreate: File = {
      analysisId: f.analysis.analysisId,
      objectId: f.objectId,
      programId: f.studyId,
      repoId: dataCenterId,

      status: f.analysis.analysisState,

      donorId: f.donors[0].donorId,

      firstPublished: f.analysis.firstPublishedAt,
      embargoStage: EmbargoStage.PROGRAM_ONLY,
      releaseState: ReleaseState.RESTRICTED,

      labels: [],
    };

    const fileRecord = await fileService.getOrCreateFileRecordByObjId(fileToCreate);
    // here we can extract the file Id/labels for indexing later
    f.fileId = fileRecord.fileId as string;
    return f;
  });

  const docsToIndex = await Promise.all(docsWithFile);

  // call elasticsearch to index the batch of enriched file documents
  await indexer.index(docsToIndex);
}
