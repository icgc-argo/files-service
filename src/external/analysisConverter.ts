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

/**
 * Note [Jon Eubank, 2021-04-09]:
 *   This is Maestro service, in everything but name.
 *
 *   Maestro is the Overture application that is used to convert a Song Analyis into
 *   FileCentric index documents. In the code, we are referring to this service as
 *                                 * analysisConverter *
 *   Naming it generically suggests that a different service could be swapped in to
 *   perform this transformation. Also, the name analysisConverter is more clear in purpose
 *   than something named 'Maestro'. There are no plans to do this but its simple enough
 *   a service that we kept the code references as the generic 'analysisConverter' instead of 'maestro'.
 *
 *   So, for current purposes, analysisConverter = Maestro.
 *
 *   https://github.com/overture-stack/maestro
 *
 */

import fetch from 'node-fetch';
import { getAppConfig } from '../config';
import logger from '../logger';

export type FileCentricDocument = { [k: string]: any } & {
  fileId: string;
  objectId: string;
  studyId: string;
  repositories: { [k: string]: string }[];
  analysis: { [k: string]: any };
};

/**
 *
 * @param analyses
 * @param repoCode
 * @returns
 */
export async function convertAnalysisToFileDocuments(
  analyses: any[],
  repoCode: string,
): Promise<FileCentricDocument[]> {
  const config = await getAppConfig();
  const url = config.analysisConverterUrl;
  const timeout = config.analysisConverterTimeout;
  if (!url) {
    throw new Error('a url for converter is not configured correctly');
  }
  logger.info(`convert analysis to file documents `);
  const result = await fetch(url, {
    body: JSON.stringify({ analyses, repoCode }),
    method: 'POST',
    timeout: timeout,
    headers: { 'Content-Type': 'application/json' },
  });
  if (result.status != 201) {
    logger.error(`response from converter: ${await result.text()}`);
    throw new Error(`failed to convert files, got response ${result.status}`);
  }
  const response: {
    [k: string]: FileCentricDocument[];
  } = await result.json();
  logger.info(`done retrieving file documents from analysisConverter`);

  // Convert the Analysis response (StringMap of FileCentricDocuments)
  let files: FileCentricDocument[] = [];

  // get the file docs arrays from maestro response
  Object.keys(response).forEach((a: string) => {
    files = files.concat(response[a]);
  });

  return files;
}
