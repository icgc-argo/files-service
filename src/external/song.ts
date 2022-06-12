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

import abortController from 'abort-controller';
import fetch from 'node-fetch';
import Batch from 'stream-json/utils/Batch';
import urljoin from 'url-join';
import streamArray from 'stream-json/streamers/StreamArray';

import { getAppConfig } from '../config';

import Logger from '../logger';
const logger = Logger('Song');

// TODO: Update kafka event parsers that use this
export type SongAnalysis = {
  analysisId: string;
  analysisState: string;
  studyId: string;
  firstPublishedAt?: string;
  [k: string]: any;
};

export const getStudies = async (url: string) => {
  const studiesUrl = urljoin(url, '/studies/all');
  logger.info(`Fetching studies from: ${studiesUrl}`);
  const res = await fetch(`${url}/studies/all`);
  const studies = await res.json();
  logger.info(`Retrieved ${studies.length} studies: ${studies}`);
  return studies;
};

/**
 * Fetch potentially very large responses from Song then return them in a batched stream.
 * @param analysesUrl
 * @returns
 */
const fetchAnalysesInBatches = async (analysesUrl: string): Promise<Batch> => {
  const controller = new abortController();
  const timeoutPeriod = (await getAppConfig()).datacenter.fetchTimeout;
  const batchSize = (await getAppConfig()).datacenter.batchSize;
  const timeout = setTimeout(() => {
    logger.warn(`Aborting request for analyses due to timeout after ${timeoutPeriod}`);
    controller.abort();
  }, timeoutPeriod);
  try {
    logger.info(`Fetching analyses from ${analysesUrl}`);
    const res = await fetch(analysesUrl, {
      signal: controller.signal,
    });
    const resStream = res.body;
    const pipeline = resStream.pipe(streamArray.withParser()).pipe(new Batch({ batchSize }));
    logger.info(`Received analyses response, returning as Batch.`);
    return pipeline;
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Return all analyses for a study pre-filtered to only include PUBLISHED analyses
 * @param url
 * @param studyId
 * @returns
 */
export const getAnalysesByStudy = async (url: string, studyId: string): Promise<Batch> => {
  const analysesUrl = urljoin(url, '/studies', studyId, '/analysis?analysisStates=PUBLISHED');
  return fetchAnalysesInBatches(analysesUrl);
};

export const getAnalysesById = async (url: string, studyId: string, analysisId: string): Promise<SongAnalysis> => {
  const analysesUrl = urljoin(
    url,
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
      logger.error(`Failure to fetch analysis ${analysisId} for ${studyId} from ${url}`);
      throw new Error(`Unable to retrieve analysis ${analysisId} for ${studyId} from ${analysesUrl}`);
    }
  } catch (e) {
    logger.error(`Error fetching analysis ${analysisId} for ${studyId} from ${analysesUrl}: ${e}`);
    throw new Error(`Unable to retrieve analysis ${analysisId} for ${studyId} from ${analysesUrl}`);
  }
};
