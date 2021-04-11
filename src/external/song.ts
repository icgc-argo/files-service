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
import streamArray from 'stream-json/streamers/StreamArray';
import Batch from 'stream-json/utils/Batch';

import { getAppConfig } from '../config';

export const getStudies = async (url: string) => {
  const res = await fetch(`${url}/studies/all`);
  const studies = await res.json();
  return studies;
};

export const getAnalysesBatchesStream = async (url: string, studyId: string): Promise<Batch> => {
  const controller = new abortController();
  const timeoutPeriod = (await getAppConfig()).datacenter.fetchTimeout;
  const batchSize = (await getAppConfig()).datacenter.batchSize;
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutPeriod);
  try {
    const res = await fetch(`${url}/studies/${studyId}/analysis?analysisStates=PUBLISHED`, {
      signal: controller.signal,
    });
    const resStream = res.body;
    const pipeline = resStream.pipe(streamArray.withParser()).pipe(new Batch({ batchSize }));
    return pipeline;
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
