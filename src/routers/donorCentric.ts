/*
 * Copyright (c) 2025 The Ontario Institute for Cancer Research. All rights reserved
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

import { Router, Request, Response, RequestHandler } from 'express';
import { AppConfig } from '../config';
import wrapAsync from '../utils/wrapAsync';

import { Errors } from '../data/files';
import {
	indexDonorCentricDocument,
	prepareDonorCentricDocumentById,
} from '../services/donorCentric/donorCentricService';
import { indexProgramDonorCentricDocuments } from '../jobs/indexProgramDonorCentricDocuments';

const createDonorCentricRouter = (config: AppConfig, authFilter: (scopes: string[]) => RequestHandler) => {
	const router = Router();

	const authFilters = {
		read: authFilter([config.auth.readScope, config.auth.writeScope]),
		write: authFilter([config.auth.writeScope]),
	};

	router.post(
		'/program/:programId/donor/:donorId',
		authFilters.write,
		wrapAsync(async (req: Request, res: Response) => {
			const { programId, donorId } = req.params;

			const result = await prepareDonorCentricDocumentById(programId, donorId);

			if (result.success) {
				await indexDonorCentricDocument(result.data, programId);
				res.status(200).json(result.data);
				return;
			}
			res.status(400).json({ status: 'error', message: result.message });
			return;
		}),
	);

	router.post(
		'/program/:programId',
		authFilters.write,
		wrapAsync(async (req: Request, res: Response) => {
			const { programId } = req.params;

			indexProgramDonorCentricDocuments('unused', programId);

			res.status(200).json({ status: 'ok', message: 'Indexing job has been started.' });
			return;
		}),
	);
	return router;
};

export default createDonorCentricRouter;
