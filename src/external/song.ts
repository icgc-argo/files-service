/*
 * Copyright (c) 2024 The Ontario Institute for Cancer Research. All rights reserved
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

import fetch from 'node-fetch';
import querystring from 'qs';
import urljoin from 'url-join';

import { getAppConfig } from '../config';
import Logger from '../logger';
import { SongAnalysisState, SongAnalysisStates } from '../utils/constants';

import { DataCenter, getDataCenter } from './dataCenterRegistry';

const logger = Logger('Song');

export type SongAnalysis = {
	analysisId: string;
	analysisState: string;
	studyId: string;
	firstPublishedAt?: string;
	[k: string]: unknown;
};

type SongResponseAnalysesPage = {
	analyses: SongAnalysis[];
	totalAnalyses: number;
	currentTotalAnalyses: number;
};

type PaginationInputs = {
	limit: number;
	offset: number;
};

type PaginationMetadata = PaginationInputs & {
	responseCount: number;
	totalCount: number;
};

export const getStudies = async (url: string) => {
	const studiesUrl = urljoin(url, '/studies/all');
	logger.info(`Fetching studies from: ${studiesUrl}`);
	const res = await fetch(`${url}/studies/all`);
	const studies = await res.json();
	logger.info(`Retrieved ${studies.length} studies: ${studies}`);
	return studies;
};

const fetchAnalysesPage = async (inputs: {
	dataCenter: DataCenter;
	studyId: string;
	offset: number;
	limit: number;
	analysisStates?: Set<SongAnalysisState>;
}): Promise<{ data: SongAnalysis[] } & PaginationMetadata> => {
	try {
		const {
			dataCenter: { centerId, songUrl },
			studyId,
			limit,
			offset,
			analysisStates,
		} = inputs;
		const analysisStatesQueryValue = analysisStates
			? Array.from(analysisStates).join(',')
			: SongAnalysisStates.PUBLISHED || SongAnalysisStates.PUBLISHED;

		const queryParams = {
			analysisStates: analysisStatesQueryValue,
			limit,
			offset,
		};

		const query = querystring.stringify(queryParams);
		const analysesUrl = urljoin(songUrl, '/studies', studyId, 'analysis', `paginated`, `?${query}`);
		const response = await fetch(analysesUrl);
		const data = (await response.json()) as SongResponseAnalysesPage;
		logger.debug('Successfully retrieved analyses from song', {
			dataCenter: centerId,
			studyId,
			limit,
			offset,
			responseCount: data.currentTotalAnalyses,
			totalCount: data.totalAnalyses,
		});

		if (!Array.isArray(data.analyses)) {
			logger.error(`Response from Song paginated analyses endpoint does not contain the expected array of analyses!`, {
				response: data,
			});
			throw new Error(
				`Response from Song's paginated analyses endpoint does not contain the expected array of analyses`,
			);
		}

		return {
			data: data.analyses,
			limit,
			offset,
			responseCount: data.currentTotalAnalyses,
			totalCount: data.totalAnalyses,
		};
	} catch (e) {
		logger.error(`Error fetching page of analyses from song`, e);
		throw new Error(`Error occurred fetching analyses page from song!`);
	}
};

/**
 * Fetch all analyses for a study. This uses song's paginated endpoint to get
 * analyses one page at a time. The size each page is determined through the
 * datacenter.songPageSize configuration variable.
 *
 * This function returns an AsyncGenerator that will yield an SongAnalyses for
 * every page that is fetched from Song
 *
 * @example
 * const analysesResponseGenerator = getAnalysesByStudy({ dataCenterId, studyId });
 * for await (const analyses of analysesResponseGenerator) {
 * 	// analyses contains an array of SongAnalyses objects retrieved from the specified dataCenter
 * }
 */
export async function* getAnalysesByStudy(details: {
	dataCenterId: string;
	studyId: string;
}): AsyncGenerator<SongAnalysis[]> {
	try {
		const dataCenter = await getDataCenter(details.dataCenterId);

		const {
			datacenter: { songPageSize },
		} = await getAppConfig();

		let allPagesFetched = false;
		let offset = 0;
		while (!allPagesFetched) {
			const response = await fetchAnalysesPage({
				dataCenter,
				studyId: details.studyId,
				offset,
				limit: songPageSize,
			});

			yield response.data;

			if (response.responseCount === 0 || response.responseCount < songPageSize) {
				allPagesFetched = true;
			} else {
				offset += songPageSize;
			}
		}
	} catch (e) {
		logger.error('Error while fetching analyses for study');
		logger.error(e);
	}
}

export const getAnalysesById = async (inputs: {
	dataCenterId: string;
	studyId: string;
	analysisId: string;
}): Promise<SongAnalysis> => {
	const { dataCenterId, studyId, analysisId } = inputs;
	const dataCenter = await getDataCenter(dataCenterId);
	const analysesUrl = urljoin(
		dataCenter.songUrl,
		'/studies',
		studyId,
		'/analysis',
		analysisId,
		'?analysisStates=PUBLISHED,UNPUBLISHED,SUPPRESSED',
	);
	try {
		const res = await fetch(analysesUrl);
		if (res.status === 200) {
			return (await res.json()) as SongAnalysis;
		} else {
			logger.error(`Failure to fetch analysis ${analysisId} for ${studyId} from ${analysesUrl}`);
			throw new Error(`Unable to retrieve analysis ${analysisId} for ${studyId} from ${analysesUrl}`);
		}
	} catch (e) {
		logger.error(`Error fetching analysis ${analysisId} for ${studyId} from ${analysesUrl}: ${e}`);
		throw new Error(`Unable to retrieve analysis ${analysisId} for ${studyId} from ${analysesUrl}`);
	}
};
