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
import { EmbargoStage, File, FileReleaseState } from '../data/files';
import { ClinicalDonor } from '../external/clinical/types';
import { SongAnalysis } from '../external/song';
import { MatchedSamplePair } from '../external/dataCenterGateway';

import Logger from '../logger';
const logger = Logger('Embargo');

/**
 * Used to determine the order of release stages for comparison with adminPromote and adminDemote values.
 */
const stageOrder: Record<EmbargoStage, number> = {
	[EmbargoStage.UNRELEASED]: 0,
	[EmbargoStage.PROGRAM_ONLY]: 1,
	[EmbargoStage.MEMBER_ACCESS]: 2,
	[EmbargoStage.ASSOCIATE_ACCESS]: 3,
	[EmbargoStage.PUBLIC]: 4,
};

/**
 * Stage is calculated from a date, based on the following timeline:
 * 0-12 months  = PROGRAM_ONLY
 * 12-18 months = MEMBER_ACCESS
 * 18-24 months = ASSOCIATE_ACCESS
 * > 24 months  = PUBLIC
 *
 * no date = UNRELEASED
 *
 * Note that for a file the embargoStart date should normally be used for this calculation.
 */
export function getEmbargoStageForDate(startDate?: Date): EmbargoStage {
	if (!startDate) {
		return EmbargoStage.UNRELEASED;
	}
	const monthsPublished = differenceInMonths(new Date(), startDate);

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
}

/**
 * Determine the emabrgo stage a file should be in.
 * The calculation is based on the embargoStart date of the file, and any admin applied promote, demote, or hold values.
 * This could calculate the correct embargo stage of a file to be PUBLIC, but be careful not
 *   to update a file to PUBLIC without going through the release process. Only a release should
 *   set a file to PUBLIC.
 * @param dbFile
 */
export function calculateEmbargoStage(dbFile: File): EmbargoStage {
	logger.debug('getEmbargoStage()', dbFile.fileId, dbFile.donorId, 'Calculating embargo stage for file');
	if (!dbFile.embargoStart) {
		// if no embargo start, this is UNRELEASED no matter what
		logger.info(
			`getEmabrgoStage()`,
			dbFile.fileId,
			dbFile.donorId,
			'No embargoStart value for file. Returning: UNRELEASED',
		);
		return EmbargoStage.UNRELEASED;
	}
	let calculatedStage = getEmbargoStageForDate(dbFile.embargoStart);

	// if adminHold is true then no change from the dbFile
	if (dbFile.adminHold) {
		logger.debug(
			'getEmbargoStage()',
			dbFile.fileId,
			dbFile.donorId,
			'File has admin hold. Returning current stage',
			dbFile.embargoStage,
		);
		return dbFile.embargoStage;
	}

	// get the expected embarge stage from the publish date
	logger.debug(
		'getEmbargoStage()',
		dbFile.fileId,
		dbFile.donorId,
		`Based on a published date of ${dbFile.firstPublished} the calculated embargo stage is: ${calculatedStage}`,
	);

	// modify this with any promote, demote, and hold rules on the file
	if (dbFile.adminPromote) {
		// Assign the most permissive of adminPromote and calculatedStage
		calculatedStage =
			stageOrder[dbFile.adminPromote] > stageOrder[calculatedStage] ? dbFile.adminPromote : calculatedStage;
		logger.debug(
			'getEmbargoStage()',
			dbFile.fileId,
			dbFile.donorId,
			`File has admin promote of ${dbFile.adminPromote}. Updating calculated stage to: ${calculatedStage}`,
		);
	}
	if (dbFile.adminDemote) {
		// Assign the least permissive of adminDemote and calculatedStage
		// This is done AFTER the adminPromote check to make sure the adminDemote value overrides any promotions
		calculatedStage =
			stageOrder[dbFile.adminDemote] < stageOrder[calculatedStage] ? dbFile.adminDemote : calculatedStage;
		logger.debug(
			'getEmbargoStage()',
			dbFile.fileId,
			dbFile.donorId,
			`File has admin demote of ${dbFile.adminDemote}. Updating calculated stage to: ${calculatedStage}`,
		);
	}
	if (dbFile.adminHold) {
		calculatedStage = dbFile.embargoStage;
		logger.debug(
			'getEmbargoStage()',
			dbFile.fileId,
			dbFile.donorId,
			`File has admin hold set to true so will return the stored embargoStage ${dbFile.embargoStage}. Updating calculated stage to: ${calculatedStage}`,
		);
	}
	logger.debug('getEmbargoStage()', dbFile.fileId, dbFile.donorId, `Returning embargo stage: ${calculatedStage}`);
	return calculatedStage;
}

/**
 * Calculate the embargoStart date for a file.
 * The rules for the start date are to find the most recent of these 3 properties:
 *  1. firstPublishedDate of the file from Song
 *  2. (unless clinicalExemption) submissionDate of the tumor and normal sample in a matched pair, available from the RDPC Gateway API
 *  3. (unless clinicalExemption) coreCompletionDate from Clinical Service
 *
 * Clinical core completion data is not required for files marked with a clinicalExemption
 *
 * Notice that this calculation requires the documents from the source APIs,
 *  it does not rely on the state of the file in the DB except for clincial exemption.
 */
export function calculateEmbargoStartDate(inputs: {
	dbFile: File;
	songAnalysis: SongAnalysis;
	matchedSamplePairs: MatchedSamplePair[];
	clinicalDonor?: ClinicalDonor;
}): Date | undefined {
	const { dbFile, songAnalysis, matchedSamplePairs, clinicalDonor } = inputs;

	// Check for clinical exemption, if no exemption then we need valid clinical data
	const clinicalExemption: boolean = dbFile.clinicalExemption !== undefined;
	const clinicalCoreComplete: boolean = clinicalDonor?.completionStats?.coreCompletionPercentage === 1 || false;
	if (!clinicalExemption) {
		if (!clinicalDonor) {
			logger.info(
				`calculateEmbargoStartDate()`,
				dbFile.fileId,
				dbFile.donorId,
				`file has no clinical donor data available and has no clinical exemption.`,
			);
			return undefined;
		}

		if (!clinicalCoreComplete) {
			logger.info(
				`calculateEmbargoStartDate()`,
				dbFile.fileId,
				dbFile.donorId,
				`file has a donor that does not have complete clinical data (not core complete), and has no clinical exemption.`,
			);
			return undefined;
		}
	}

	// 1. First Published date of this file's song analysis
	const analysisFirstPublished = maybeDate(songAnalysis.firstPublishedAt);

	// 2. Most recent First Published date of all matched pairs for this donor
	//  This checks that each sample pair has a firstPublished date (to exclude pairs that havent been published before),
	//   and then finds the most recent date of all the published pairs
	const matchedPairFirstPublished: Date | undefined = matchedSamplePairs
		.flatMap(pair =>
			pair.normalSampleAnalysis.firstPublishedAt && pair.tumourSampleAnalysis.firstPublishedAt
				? [maybeDate(pair.normalSampleAnalysis.firstPublishedAt), maybeDate(pair.tumourSampleAnalysis.firstPublishedAt)]
				: [],
		)
		.sort()
		.slice(-1)[0];

	// 3. clinical core completion date
	const clinicalCoreCompletionDate = maybeDate(clinicalDonor?.completionStats?.coreCompletionDate || undefined);

	if (analysisFirstPublished && (clinicalExemption || (matchedPairFirstPublished && clinicalCoreCompletionDate))) {
		const options: Date[] = [analysisFirstPublished];
		if (!clinicalExemption) {
			// safe to cast to Date here based on if logic above
			options.push(clinicalCoreCompletionDate as Date);
			options.push(matchedPairFirstPublished as Date);
		}
		const output = options.sort().slice(-1)[0]; // sort dates and take last one
		logger.info(
			'calculateEmbargoStartDate()',
			dbFile.fileId,
			dbFile.donorId,
			`Calculated embargoStart value ${output} for file ${dbFile.fileId} based on first published, matched sample pair, and core completion dates`,
			`first published: ${analysisFirstPublished}`,
			clinicalExemption
				? `clinical exemption: ${dbFile.clinicalExemption}`
				: `clinical core completed: ${clinicalCoreCompletionDate?.toISOString()} - matched pair first published: ${matchedPairFirstPublished?.toISOString()}`,
		);
		return output;
	} else {
		logger.info(
			'calculateEmbargoStartDate()',
			dbFile.fileId,
			dbFile.donorId,
			`Calculated that there is no start date yet for file ${dbFile.fileId} based on first published, matched sample pair, and core completion dates`,
			`first published: ${analysisFirstPublished}`,
			clinicalExemption
				? `clinical exemption: ${dbFile.clinicalExemption}`
				: `clinical core completed: ${clinicalCoreCompletionDate?.toISOString()} - matched pair first published: ${matchedPairFirstPublished?.toISOString()}`,
		);
		return undefined;
	}
}

/**
 * utility method to make Date or Undefined out of optional string values
 * @param value
 * @returns
 */
function maybeDate(value: string | number | undefined): Date | undefined {
	try {
		const typeCheckedValue = isNaN(Number(value)) ? value : Number(value);
		if (typeCheckedValue) {
			const date = new Date(typeCheckedValue);
			if (date && isNaN(date.getTime())) {
				logger.warn(`Value could not be parsed into date`, value, date);
				return undefined;
			}
			return date;
		}
		return undefined;
	} catch (err) {
		logger.warn(`Error thrown parsing value as date`, value, err);
		return undefined;
	}
}
