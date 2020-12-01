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
import fetch from 'node-fetch';
import { getAppConfig } from './config';
import { FileCentricDocument } from './entity';
import logger from './logger';

export async function convertAnalysisToFileDocuments(
  analysis: any,
  repoCode: string,
): Promise<{
  [k: string]: FileCentricDocument[];
}> {
  const url = (await getAppConfig()).analysisConverterUrl;
  if (!url) {
    throw new Error('a url for converter is not configured correctly');
  }
  const result = await fetch(url, {
    body: JSON.stringify({ analyses: [analysis], repoCode }),
    method: 'POST',
    timeout: 1000, // todo make configurable
    headers: { 'Content-Type': 'application/json' },
  });
  if (result.status != 201) {
    logger.error(`response from converter: ${await result.text()}`);
    throw new Error(`failed to convert files, got response ${result.status}`);
  }
  const response = await result.json();

  return response;
}
