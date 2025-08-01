/*
 * Copyright (c) 2023 The Ontario Institute for Cancer Research. All rights reserved
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
import * as fileService from '../data/files';
import Logger from '../logger';
import { updateFileFromExternalSources } from '../services/fileManager';
import { Indexer, getFileCentricIndexer } from '../services/fileCentricIndexer';
const logger = Logger('Job:RecalculateFileEmbargo');

async function recalculateFile(file: fileService.File, indexer: Indexer) {
	try {
		logger.debug(
			`checking file`,
			file.programId,
			file.fileId,
			file.embargoStage,
			file.releaseState,
			file.embargoStart || '',
		);
		const updatedFile = await updateFileFromExternalSources(file);

		logger.debug(
			`updatedFile`,
			file.programId,
			file.fileId,
			file.embargoStage,
			file.releaseState,
			file.embargoStart || '',
		);
		if (updatedFile.embargoStage !== file.embargoStage || updatedFile.releaseState !== file.releaseState) {
			logger.debug(`file has changed, updating!`);
			await indexer.updateRestrictedFile(updatedFile);
		}
	} catch (err) {
		logger.error(`Error while recalculating embargo stage for file`, file.fileId, err);
	}
}

const recalculateFileEmbargo = async () => {
	try {
		logger.info(`Starting!`);

		const indexer = await getFileCentricIndexer();

		const fileCount = await fileService.countFiles({});
		logger.debug(`total files: ${fileCount}`);

		for await (const file of fileService.getAllFiles()) {
			await recalculateFile(file, indexer);
		}

		logger.info(`Indexing updated restricted files`);
		indexer.release();

		logger.info(`Finished!`);
	} catch (e) {
		if (e instanceof Error) {
			logger.error(`Recalculate file embargo job threw error:`, e.message, e.stack);
		} else {
			logger.error(`Recalculate file embargo job failed:`, e);
		}
	}
};
export default recalculateFileEmbargo;
