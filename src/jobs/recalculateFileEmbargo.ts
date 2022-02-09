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
import Logger from '../logger';
import * as fileService from '../data/files';
import { recalculateFileState } from '../services/fileManager';
import { getIndexer, Indexer } from '../services/indexer';
const logger = Logger('Job:RecalculateFileEmbargo');

const recalculateFileEmbargo = async () => {
  logger.info(`Starting!`);

  const indexer = await getIndexer();

  const fileCount = await fileService.countFiles({});
  logger.debug(`total files: ${fileCount}`);

  for await (const file of fileService.getAllFiles({})) {
    logger.debug(
      `checking file`,
      file.programId,
      file.fileId,
      file.embargoStage,
      file.releaseState,
      file.firstPublished || '',
    );
    const updatedFile = await recalculateFileState(file);

    logger.debug(`updatedFile`, updatedFile.embargoStage, updatedFile.releaseState);
    if (
      updatedFile.embargoStage !== file.embargoStage ||
      updatedFile.releaseState !== file.releaseState
    ) {
      logger.debug(`file has changed, updating!`);
      await indexer.updateRestrictedFile(updatedFile);
    }
  }

  logger.info(`Indexing updated restricted files`);
  indexer.release();

  logger.info(`Finished!`);
};
export default recalculateFileEmbargo;
