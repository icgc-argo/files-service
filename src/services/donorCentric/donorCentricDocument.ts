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

import { z } from 'zod';

import { File } from '../../data/files/file.model';
import { ClinicalDonor } from '../../external/clinical/types';
import { SongAnalysis } from '../../external/song';
import Logger from '../../logger';
import { stripNulls } from '../../utils/stripNulls';

const logger = Logger('donorCentricDocument');

const esKeyword = z
	.string()
	.or(z.string().array())
	.nullish();
const esNumber = z
	.number()
	.or(z.number().array())
	.nullish();

const fileSchema = z.object({
	file_id: esKeyword,
	analysis_tools: esKeyword,
	data_category: esKeyword,
	data_subtype: esKeyword,
	data_type: esKeyword,
	description: esKeyword,
	file_number: esNumber,
	file_type: esKeyword,
	md5sum: esKeyword,
	name: esKeyword,
	object_id: esKeyword,
	size: esNumber,
});

type FileData = z.infer<typeof fileSchema>;

const repositorySchema = z.object({
	code: esKeyword,
	country: esKeyword,
	name: esKeyword,
	organization: esKeyword,
	url: esKeyword,
});

const analysisSchema = z.object({
	analysis_id: esKeyword,
	files: fileSchema.array().nullish(),
	repositories: repositorySchema.array().nullish(),
	analysis_type: esKeyword,
	analysis_state: esKeyword,
	analysis_version: esNumber,
	experiment: z
		.object({
			experimental_strategy: esKeyword,
			platform: esKeyword,
		})
		.nullish(),
	file_access: esKeyword,
	first_published_at: esKeyword, // TODO: This may want to be coereced into a datetime, but no immediate need for this
	metrics: z
		.object({
			average_insert_size: esNumber,
			average_length: esNumber,
			duplicated_bases: esNumber,
			error_rate: esNumber,
			mapped_bases_cigar: esNumber,
			mapped_reads: esNumber,
			mismatch_bases: esNumber,
			paired_reads: esNumber,
			pairs_on_different_chromosomes: esNumber,
			properly_paired_reads: esNumber,
			total_bases: esNumber,
			total_reads: esNumber,
		})
		.nullish(),
	variant_class: esKeyword,
	workflow: z
		.object({
			workflow_name: esKeyword,
			workflow_version: esKeyword,
		})
		.nullish(),
});

const primaryDiagnosisSchema = z.object({
	primary_diagnosis_id: esKeyword,
	submitter_primary_diagnosis_id: esKeyword,
	age_at_diagnosis: esNumber,
	cancer_type_code: esKeyword,
	cancer_type_additional_information: esKeyword,
	basis_of_diagnosis: esKeyword,
	laterality: esKeyword,
	lymph_nodes_examined_status: esKeyword,
	lymph_nodes_examined_method: esKeyword,
	number_lymph_nodes_examined: esNumber,
	number_lymph_nodes_positive: esNumber,
	clinical_tumour_staging_system: esKeyword,
	clinical_t_category: esKeyword,
	clinical_n_category: esKeyword,
	clinical_m_category: esKeyword,
	clinical_stage_group: esKeyword,
	presenting_symptoms: esKeyword,
	performance_status: esKeyword,
});

const familyHistorySchema = z.object({
	family_relative_id: esKeyword,
	relative_with_cancer_history: esKeyword,
	relationship_type: esKeyword,
	gender_of_relative: esKeyword,
	age_of_relative_at_diagnosis: esNumber,
	cancer_type_code_of_relative: esKeyword,
	relative_vital_status: esKeyword,
	cause_of_death_of_relative: esKeyword,
	relative_survival_time: esNumber,
});

const exposureSchema = z.object({
	tobacco_smoking_status: esKeyword,
	tobacco_smoking_tobacco_typestatus: esKeyword,
	pack_years_smoked: esNumber,
	alcohol_history: esKeyword,
	alcohol_consumption_category: esKeyword,
	alcohol_type: esKeyword,
	opiate_use: esKeyword,
	hot_drinks_consumption: esKeyword,
	red_meat_frequency: esKeyword,
	processed_meat_frequency: esKeyword,
	soft_drinks_frequency: esKeyword,
	exercise_frequency: esKeyword,
	exercise_intensity: esKeyword,
});

const followUpSchema = z.object({
	follow_up_id: esKeyword,
	submitter_follow_up_id: esKeyword,
	interval_of_followup: esNumber,
	disease_status_at_followup: esKeyword,
	submitter_primary_diagnosis_id: esKeyword,
	submitter_treatment_id: esKeyword,
	weight_at_followup: esNumber,
	relapse_type: esKeyword,
	relapse_interval: esNumber,
	method_of_progression_status: esKeyword,
	anatomic_site_progression_or_recurrence: esKeyword,
	recurrence_tumour_staging_system: esKeyword,
	recurrence_t_category: esKeyword,
	recurrence_n_category: esKeyword,
	recurrence_m_category: esKeyword,
	recurrence_stage_group: esKeyword,
	posttherapy_tumour_staging_system: esKeyword,
	posttherapy_t_category: esKeyword,
	posttherapy_n_category: esKeyword,
	posttherapy_m_category: esKeyword,
	posttherapy_stage_group: esKeyword,
});

const therapySchema = z
	.object({
		therapy_type: esKeyword,
	})
	.merge(
		z.object({
			// chemotherapy
			drug_rxnormcui: esKeyword,
			drug_name: esKeyword,
			chemotherapy_drug_dose_units: esKeyword,
			prescribed_cumulative_drug_dose: esNumber,
			actual_cumulative_drug_dose: esNumber,
			dose_intensity_reduction: esKeyword,
			dose_intensity_reduction_event: esKeyword,
			dose_intensity_reduction_amount: esKeyword,
		}),
	)
	.merge(
		z.object({
			// hormone
			drug_rxnormcui: esKeyword,
			drug_name: esKeyword,
			drug_database: esKeyword,
			drug_id: esKeyword,
			drug_term: esKeyword,
			hormone_drug_dose_units: esKeyword,
			prescribed_cumulative_drug_dose: esNumber,
			actual_cumulative_drug_dose: esNumber,
		}),
	)
	.merge(
		z.object({
			// radiation
			radiation_therapy_modality: esKeyword,
			radiation_therapy_type: esKeyword,
			radiation_therapy_fractions: esNumber,
			radiation_therapy_dosage: esNumber,
			anatomical_site_irradiated: esKeyword,
			radiation_boost: esKeyword,
			reference_radiation_treatment_id: esKeyword,
		}),
	)
	.merge(
		z.object({
			// immunotherapy
			immunotherapy_type: esKeyword,
			drug_rxnormcui: esKeyword,
			drug_name: esKeyword,
			drug_database: esKeyword,
			drug_id: esKeyword,
			drug_term: esKeyword,
			immunotherapy_drug_dose_units: esKeyword,
			prescribed_cumulative_drug_dose: esNumber,
			actual_cumulative_drug_dose: esNumber,
		}),
	)
	.merge(
		z.object({
			// surgery
			surgery_type: esKeyword,
			surgery_site: esKeyword,
			surgery_location: esKeyword,
			tumour_length: esNumber,
			tumour_width: esNumber,
			greatest_dimension_tumour: esNumber,
			tumour_focality: esKeyword,
			residual_tumour_classification: esKeyword,
			margin_types_involved: esKeyword,
			margin_types_not_involved: esKeyword,
			margin_types_not_assessed: esKeyword,
			lymphovascular_invasion: esKeyword,
			perineural_invasion: esKeyword,
			extrathyroidal_extension: esKeyword,
		}),
	)
	.partial();

const treatmentSchema = z.object({
	therapies: therapySchema.array().nullish(),
	treatment_id: esKeyword,
	submitter_treatment_id: esKeyword,
	submitter_primary_diagnosis_id: esKeyword,
	treatment_type: esKeyword,
	is_primary_treatment: esKeyword,
	line_of_treatment: esNumber,
	treatment_start_interval: esNumber,
	treatment_duration: esNumber,
	days_per_cycle: esNumber,
	number_of_cycles: esNumber,
	treatment_intent: esKeyword,
	treatment_setting: esKeyword,
	response_to_treatment_criteria_method: esKeyword,
	response_to_treatment: esKeyword,
	outcome_of_treatment: esKeyword,
	toxicity_type: esKeyword,
	hematological_toxicity: esKeyword,
	non_hematological_toxicity: esKeyword,
	adverse_events: esKeyword,
	clinical_trials_database: esKeyword,
	clinical_trial_number: esKeyword,
});

const sampleSchema = z.object({
	sample_id: esKeyword,
	submitter_sample_id: esKeyword,
	matched_normal_submitter_sample_id: esKeyword,
	sample_type: esKeyword,
});
type SpecimenData = z.infer<typeof sampleSchema>;

const specimenSchema = z.object({
	specimen_id: esKeyword,
	submitter_specimen_id: esKeyword,
	pathological_m_category: esKeyword,
	pathological_n_category: esKeyword,
	pathological_stage_group: esKeyword,
	pathological_t_category: esKeyword,
	pathological_tumour_staging_system: esKeyword,
	percent_inflammatory_tissue: esNumber,
	percent_necrosis: esNumber,
	percent_proliferating_cells: esNumber,
	percent_stromal_cells: esNumber,
	percent_tumour_cells: esNumber,
	percent_tumour_cells_measurement_method: esKeyword,
	primary_diagnosis_id: esKeyword,
	reference_pathology_confirmed: esKeyword,
	specimen_acquisition_interval: esNumber,
	specimen_anatomic_location: esKeyword,
	specimen_laterality: esKeyword,
	specimen_processing: esKeyword,
	specimen_storage: esKeyword,
	specimen_tissue_source: esKeyword,
	specimen_type: esKeyword,
	submitter_primary_diagnosis_id: esKeyword,
	tumour_grade: esKeyword,
	tumour_grading_system: esKeyword,
	tumour_histological_type: esKeyword,
	tumour_normal_designation: esKeyword,
});

export const donorCentricDocumentSchema = z.object({
	donor_id: esKeyword,
	study_id: esKeyword,
	submitter_donor_id: esKeyword,

	analyses: analysisSchema.array().nullish(),
	specimens: specimenSchema.array().nullish(),
	family_history: familyHistorySchema.array().nullish(),
	follow_ups: followUpSchema.array().nullish(),
	treatments: treatmentSchema.array().nullish(),
	primary_diagnosis: primaryDiagnosisSchema.array().nullish(),
	exposure: exposureSchema,

	cause_of_death: esKeyword,
	gender: esKeyword,
	updated_at: z
		.string()
		.datetime()
		.nullish(),
	age_at_menarche: esNumber,
	bmi: esNumber,
	height: esNumber,
	menopause_status: esKeyword,
	number_of_children: esNumber,
	number_of_pregnancies: esNumber,
	primary_site: esKeyword,
	genetic_disorders: esKeyword,
	survival_time: esNumber,
	vital_status: esKeyword,
	hrt_type: esNumber,
	hrt_duration: esKeyword,
	contraception_type: esNumber,
	contraception_duration: esKeyword,
	weight: esNumber,
});

export type DonorCentricDocument = z.infer<typeof donorCentricDocumentSchema>;

function extractDonorExposureData(donor: ClinicalDonor): DonorCentricDocument['exposure'] {
	const output = donor.exposure?.reduce<DonorCentricDocument['exposure']>((acc, exposureObj) => {
		// parse with schema to strip out unknown properties. will fail if values are the wrong types, but not if they are missing.
		const parseResult = exposureSchema.safeParse(stripNulls(exposureObj.clinicalInfo));
		return parseResult.success
			? {
					...acc,
					...parseResult.data,
			  }
			: acc;
	}, {});

	return output || {};
}

function extractDonorFamilyHistoryData(donor: ClinicalDonor): DonorCentricDocument['family_history'] {
	const output: DonorCentricDocument['family_history'] | undefined = donor.familyHistory?.map(familyHistryObj => {
		// parse with schema to strip out unknown properties. will fail if values are the wrong types, but not if they are missing.
		const parseResult = familyHistorySchema.safeParse(stripNulls(familyHistryObj.clinicalInfo));
		return parseResult.success
			? {
					...parseResult.data,
			  }
			: {};
	});

	return output || [];
}

function extractDonorFollowUpsData(donor: ClinicalDonor): DonorCentricDocument['follow_ups'] {
	const output: DonorCentricDocument['follow_ups'] | undefined = donor.followUps?.map(followUpObj => {
		// parse with schema to strip out unknown properties. will fail if values are the wrong types, but not if they are missing.
		const parseResult = followUpSchema.safeParse(stripNulls(followUpObj.clinicalInfo));
		if (!parseResult.success) {
			logger.error('followup', parseResult.error.issues);
		}
		return {
			follow_up_id: `${followUpObj.followUpId}`,
			...(parseResult.success ? parseResult.data : {}),
		};
	});

	return output || [];
}
function extractDonorPrimaryDiagnosisData(donor: ClinicalDonor): DonorCentricDocument['primary_diagnosis'] {
	const output: DonorCentricDocument['primary_diagnosis'] | undefined = donor.primaryDiagnoses?.map(
		primaryDiagnosisObj => {
			// parse with schema to strip out unknown properties. will fail if values are the wrong types, but not if they are missing.
			const parseResult = primaryDiagnosisSchema.safeParse(stripNulls(primaryDiagnosisObj.clinicalInfo));
			if (!parseResult.success) {
				logger.error('primary diagnosis', parseResult.error.issues);
			}
			return {
				...(parseResult.success ? parseResult.data : {}),
				primary_diagnosis_id: `${primaryDiagnosisObj.primaryDiagnosisId}`,
			};
		},
	);

	return output || [];
}

function extractDonorTreatmentsData(donor: ClinicalDonor): DonorCentricDocument['treatments'] {
	const output: DonorCentricDocument['treatments'] | undefined = donor.treatments?.map(treatmentObj => {
		const therapies = treatmentObj.therapies.map(therapyObj => {
			const therapyParseResult = therapySchema.safeParse(stripNulls(therapyObj.clinicalInfo));
			if (!therapyParseResult.success) {
				logger.error('therapy', therapyParseResult.error.issues);
			}
			return {
				...(therapyParseResult.success ? therapyParseResult.data : {}),
				therapy_type: therapyObj.therapyType,
			};
		});
		// parse with schema to strip out unknown properties. will fail if values are the wrong types, but not if they are missing.
		const parseResult = treatmentSchema.safeParse(stripNulls(treatmentObj.clinicalInfo));
		if (!parseResult.success) {
			logger.error('treatment', parseResult.error.issues);
		}
		// special case, term we need to change the property name (to remove the hyphen)
		const sourceNonHematologicalToxicity = treatmentObj.clinicalInfo['non-hematological_toxicity'];
		const sourceNonHematologicalToxicityParseResult = z
			.string()
			.or(z.string().array())
			.safeParse(sourceNonHematologicalToxicity);
		const non_hematological_toxicity = sourceNonHematologicalToxicityParseResult.success
			? sourceNonHematologicalToxicityParseResult.data
			: undefined;

		return {
			...(parseResult.success ? parseResult.data : {}),
			treatment_id: `${treatmentObj.treatmentId}`,
			therapies: therapies,
			non_hematological_toxicity,
		};
	});

	return output || [];
}
function extractDonorSpecimenData(donor: ClinicalDonor): DonorCentricDocument['specimens'] {
	const output: DonorCentricDocument['specimens'] | undefined = donor.specimens?.map(specimenObj => {
		const samples = specimenObj.samples.map<SpecimenData>(sample => {
			return {
				sample_id: sample.sampleId,
				sample_type: sample.sampleType,
				submitter_sample_id: sample.submitterId,
			};
		});
		// parse with schema to strip out unknown properties. will fail if values are the wrong types, but not if they are missing.
		const parseResults = specimenSchema.safeParse(stripNulls(specimenObj.clinicalInfo));
		return {
			...(parseResults.success ? parseResults.data : {}),
			samples,
			specimen_tissue_source: specimenObj.specimenTissueSource,
			submitter_specimen_id: specimenObj.specimenId,
			specimen_id: specimenObj.specimenId,
			tumour_normal_designation: specimenObj.tumourNormalDesignation,
			specimen_type: specimenObj.specimenType,
		};
	});

	return output || [];
}

export function buildDonorCentricDocument({
	donor,
	analyses,
	files,
}: {
	donor: ClinicalDonor;
	analyses: SongAnalysis[];
	files: File[];
}): DonorCentricDocument {
	// const groupedFiles = _.groupBy(files, 'analysisId');

	const outputAnalyses: DonorCentricDocument['analyses'] = analyses.map(analysis => {
		const analysisId = analysis.analysisId;
		// const filesRecords = groupedFiles[analysisId] || [];
		const fileData: FileData[] = analysis.files
			.map<FileData | undefined>(analysisFile => {
				const matchingFileRecord = files.find(fileRecord => fileRecord.analysisId === analysisId);
				if (!matchingFileRecord) {
					return undefined;
				}

				return {
					file_id: matchingFileRecord.fileId,
					file_number: matchingFileRecord.fileNumber,

					analysis_tools: analysisFile.info?.analysis_tools,
					data_category: analysisFile.info?.data_category,
					file_access: analysisFile.fileAccess,
					file_type: analysisFile.fileType,
					md5sum: analysisFile.fileMd5sum,
					name: analysisFile.fileName,
					object_id: analysisFile.objectId,
					size: analysisFile.fileSize,
				};
			})
			.filter(element => !!element);

		const experiment = analysis.experiment ? { ...analysis.experiment } : {};
		const metrics = analysis.metrics ? { ...analysis.metrics } : {};

		return {
			analysis_id: analysis.analysisId,
			analysis_state: analysis.analysisState,
			analysis_type: analysis.analysisType.name,
			analysis_version: analysis.analysisType.version,
			experiment: experiment,
			metrics: metrics,

			files: fileData,

			// TODO: add repository information to the function input
			repositories: [],

			workflow: {
				workflow_name: analysis.workflow?.workflow_name,
				workflow_version: analysis.workflow?.workflow_version,
			},
		};
	});

	const specimens: DonorCentricDocument['specimens'] = extractDonorSpecimenData(donor);

	const output: DonorCentricDocument = {
		donor_id: donor.donorId,
		gender: donor.gender,
		submitter_donor_id: donor.submitterId,
		study_id: donor.programId,
		updated_at: donor.updatedAt,
		...stripNulls(donor.clinicalInfo),

		exposure: extractDonorExposureData(donor),
		family_history: extractDonorFamilyHistoryData(donor),
		follow_ups: extractDonorFollowUpsData(donor),
		primary_diagnosis: extractDonorPrimaryDiagnosisData(donor),
		treatments: extractDonorTreatmentsData(donor),

		analyses: outputAnalyses,
		specimens,
	};
	return output;
}
