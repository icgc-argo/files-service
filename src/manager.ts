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
import { convertAnalysisToFileDocuments } from './analysisConverter';
import * as service from './service';
import { AnalysisUpdateEvent, File, FileCentricDocument } from './entity';

export async function handleAnalysisPublishEvent(analysisEvent: AnalysisUpdateEvent) {
  const analysis = analysisEvent.analysis;
  const dataCenterId = analysisEvent.songServerId;

  // get genomic files for an analysis
  const filesByAnalysisId = await convertAnalysisToFileDocuments(analysis, dataCenterId);
  let files: FileCentricDocument[] = [];

  // get the file docs arrays from maestro response
  Object.keys(filesByAnalysisId).forEach((a: string) => {
    files = files.concat(filesByAnalysisId[a]);
  });

  const docsWithFile = files.map(async (f: FileCentricDocument) => {
    const fileToCreate: File = {
      analysisId: f.analysis.analysisId,
      objectId: f.objectId,
      programId: f.studyId,
      repoId: dataCenterId,
      labels: [],
    };

    const fileRecord = await service.getOrCreateFileRecordByObjId(fileToCreate);

    // here we can extract the file Id/labels for indexing later
    f.fileId = fileRecord.fileId as string;
    return f;
  });

  // call clinical to fetch file centric clinical fields

  // call elasticsearch to index the batch of enriched file documents

  // for now return the docs
  const docsToIndex = await Promise.all(docsWithFile);
  return docsToIndex;
}
