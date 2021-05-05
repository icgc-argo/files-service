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

import { differenceInMonths } from 'date-fns';
import logger from '../logger';
import { EmbargoStage, File, FileReleaseState } from '../data/files';
import { first } from 'lodash';

const stageOrder = {
  [EmbargoStage.PROGRAM_ONLY]: 0,
  [EmbargoStage.MEMBER_ACCESS]: 1,
  [EmbargoStage.ASSOCIATE_ACCESS]: 2,
  [EmbargoStage.PUBLIC]: 3,
};
export const sortStages = (stages: EmbargoStage[]): EmbargoStage[] => {
  return stages.sort(compareStages);
};
export const compareStages = (stage: EmbargoStage, compareTo: EmbargoStage): 1 | -1 => {
  return stageOrder[stage] > stageOrder[compareTo] ? 1 : -1;
};

/**
 * Stage is calculated from a file's First Published Date, based on the following timeline:
 * 0-12 months  = PROGRAM_ONLY
 * 12-18 months = MEMBER_ACCESS
 * 18-24 months = ASSOCIATE_ACCESS
 * > 24 months  = PUBLIC
 *
 * no published date = PROGRAM_ONLY
 */
const getEmbargoStageForPublishDate = (firstPublishedAt?: Date): EmbargoStage => {
  if (!firstPublishedAt) {
    return EmbargoStage.PROGRAM_ONLY;
  }
  const monthsPublished = differenceInMonths(new Date(), firstPublishedAt);

  // Set expectedStage based on time passed since published
  let expectedStage = EmbargoStage.PROGRAM_ONLY;

  switch (true) {
    case monthsPublished >= 24:
      expectedStage = EmbargoStage.PUBLIC;
      break;
    case monthsPublished >= 18:
      expectedStage = EmbargoStage.ASSOCIATE_ACCESS;
      break;
    case monthsPublished >= 12:
      expectedStage = EmbargoStage.MEMBER_ACCESS;
      break;
    default:
      // Doesn't change anything, incldued for completeness.
      expectedStage = EmbargoStage.PROGRAM_ONLY;
      break;
  }

  return expectedStage;
};

/**
 * For a file, determine what embarge stage it should be in.
 * It is important that whatever calls this method does not directly set the file to PUBLIC
 *   if that is the returned value. Only going through the release process should set the
 *   embargoStage to PUBLIC.
 * @param dbFile
 */
export const getEmbargoStage = (dbFile: File): EmbargoStage => {
  logger.debug(`[Embargo] ${dbFile.fileId}: Recalculating embargo stage`);

  // a releaseState of PUBLIC means this is already public, return EmbargoStage of PUBLIC
  if (dbFile.releaseState === FileReleaseState.PUBLIC) {
    logger.debug(`[Embargo] ${dbFile.fileId}: File is already public.`);
    return EmbargoStage.PUBLIC;
  }

  // if adminHold is true then no change from the dbFile
  if (dbFile.adminHold) {
    logger.debug(
      `[Embargo] ${dbFile.fileId}: File has admin hold. Returning current stage: ${dbFile.embargoStage}`,
    );
    return dbFile.embargoStage;
  }

  // get the expected embarge stage from the publish date
  let calculatedStage = getEmbargoStageForPublishDate(dbFile.firstPublished);
  logger.debug(
    `[Embargo] ${dbFile.fileId}: Based on a published date of ${dbFile.firstPublished} the calculated embargo stage is: ${calculatedStage}`,
  );

  // modify this with any promote, limit, and hold rules on the file
  if (dbFile.adminPromote) {
    // Assign the most permissive of adminPromote and calculatedStage
    calculatedStage =
      stageOrder[dbFile.adminPromote] > stageOrder[calculatedStage]
        ? dbFile.adminPromote
        : calculatedStage;
    logger.debug(
      `[Embargo] ${dbFile.fileId}: File has admin promote of ${dbFile.adminPromote}. Updating calculated stage to: ${calculatedStage}`,
    );
  }
  logger.debug(`[Embargo] ${dbFile.fileId}: Returning embargo stage: ${calculatedStage}`);
  return calculatedStage;
};
