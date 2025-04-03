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
import _ from 'lodash';

import { SongAnalysis } from '../../external/song';
import { ClinicalDonor } from '../../external/clinical/types';
import { FileMongooseDocument } from '../../data/files/file.model';

const fileSchema = z
	.object({
		file_id: z.string(),
	})
	.merge(
		z
			.object({
				analysis_tools: z.string().array(),
				data_category: z.string(),
				data_subtype: z.string(),
				description: z.string(),
				file_number: z.number().int(),
				file_type: z.string(),
				md5sum: z.string(),
				name: z.string(),
				object_id: z.string(),
				size: z.number().int(),
			})
			.partial(),
	)
	.passthrough();
type File = z.infer<typeof fileSchema>;

const repositorySchema = z
	.object({
		code: z.string(),
		country: z.string(),
		name: z.string(),
		organization: z.string(),
		url: z.string(),
	})
	.partial()
	.passthrough();

const analysisSchema = z
	.object({
		analysis_id: z.string(),
		files: fileSchema.array(),
		repositories: repositorySchema.array(),
	})
	.merge(
		z
			.object({
				analysis_type: z.string(),
				analysis_state: z.string(),
				analysis_version: z.number().int(),
				experiment: z
					.object({
						experimental_strategy: z.string(),
						platform: z.string(),
					})
					.partial()
					.passthrough(),
				file_access: z.string(),
				first_published_at: z.string().datetime(),
				metrics: z
					.object({
						average_insert_size: z.number(),
						average_length: z.number().int(),
						duplicated_bases: z.number(),
						error_rate: z.number(),
						mapped_bases_cigar: z.number(),
						mapped_reads: z.number(),
						mismatch_bases: z.number(),
						paired_reads: z.number(),
						pairs_on_different_chromosomes: z.number(),
						properly_paired_reads: z.number(),
						total_bases: z.number(),
						total_reads: z.number(),
					})
					.partial()
					.passthrough(),

				variant_class: z.string(),
				workflow: z
					.object({
						workflow_name: z.string(),
						workflow_version: z.string(),
					})
					.partial()
					.passthrough(),
			})
			.partial(),
	)
	.passthrough();

type Analysis = z.infer<typeof analysisSchema>;

const sampleSchema = z
	.object({ sample_id: z.string() })
	.merge(
		z
			.object({
				submitter_sample_id: z.string(),
				matched_normal_submitter_sample_id: z.string(),
				sample_type: z.string(),
			})
			.partial(),
	)
	.passthrough();
const specimenSchema = z
	.object({ specimen_id: z.string(), samples: sampleSchema.array() })
	.merge(
		z
			.object({
				submitter_specimen_id: z.string(),
				specimen_tissue_source: z.string(),
				specimen_type: z.string(),
				tumour_normal_designation: z.string(),
				pathological_m_category: z.string(),
				pathological_n_category: z.string(),
				pathological_stage_group: z.string(),
				pathological_t_category: z.string(),
				pathological_tumour_staging_system: z.string(),
				percent_inflammatory_tissue: z.number(),
				percent_necrosis: z.number(),
				percent_proliferating_cells: z.number(),
				percent_stromal_cells: z.number(),
				percent_tumour_cells: z.number(),
				primary_diagnosis_id: z.string(),
				reference_pathology_confirmed: z.string(),
				specimen_acquisition_interval: z.number().int(),
				specimen_anatomic_location: z.string(),
				specimen_processing: z.string(),
				specimen_storage: z.string(),
				submitter_primary_diagnosis_id: z.string(),
				tumour_grade: z.string(),
				tumour_grading_system: z.string(),
				tumour_histological_type: z.string(),
			})
			.partial(),
	)
	.passthrough();

export const donorCentricDocumentSchema = z
	.object({
		donor_id: z.string(),
		study_id: z.string(),
		analyses: analysisSchema.array(),
		specimens: specimenSchema.array(),
	})
	.merge(
		z
			.object({
				submitter_donor_id: z.string(),
				cause_of_death: z.string(),
				gender: z.string(),
				updated_at: z.string().datetime(),
				age_at_menarche: z.number().int(),
				bmi: z.number(),
				height: z.number().int(),
				menopause_status: z.string(),
				number_of_children: z.number().int(),
				number_of_pregnancies: z.number().int(),
				survival_time: z.number().int(),
				vital_status: z.string(),
				weight: z.number().int(),
			})
			.partial(),
	)
	.passthrough();

export type DonorCentricDocument = z.infer<typeof donorCentricDocumentSchema>;

export function buildDonorCentricDocument({
	donor,
	analyses,
	files,
}: {
	donor: ClinicalDonor;
	analyses: SongAnalysis[];
	files: FileMongooseDocument[];
}): DonorCentricDocument {
	const groupedFiles = _.groupBy(files, 'analysisId');

	const outputAnalyses: DonorCentricDocument['analyses'] = analyses.map(analysis => {
		const experiment = typeof analysis.experiment === 'object' && analysis.experiment ? { ...analysis.experiment } : {};
		const metrics = typeof analysis.metrics === 'object' && analysis.metrics ? { ...analysis.metrics } : {};

		// TODO: Combine db files and analysis files into files array

		return {
			analysis_id: analysis.analysisId,
			analysis_state: analysis.analysisState,
			// analysis_type: analysis.analysisType, // TODO
			// analysis_version: // TODO
			experiment: experiment,
			metrics: metrics,

			files: [],
			repositories: [],
		};
	});
	const specimens: DonorCentricDocument['specimens'] = [];

	analyses.map(analysis => {});

	const output: DonorCentricDocument = {
		donor_id: donor.donorId,
		gender: donor.gender,
		submitter_donor_id: donor.submitterId,
		study_id: donor.programId,
		updated_at: donor.updatedAt,

		analyses: outputAnalyses,
		specimens,
	};
	return output;
}

const example = {
	donor_id: 'DO264797',
	gender: 'Female',
	study_id: 'TEST-CA',

	analyses: [
		{
			analysis_id: 'ecd9a6f4-dc67-4c00-99a6-f4dc672c0058',
			files: [
				{
					file_id: 'FL4294',
					analysis_tools: ['BWA-MEM', 'biobambam2:bammarkduplicates2'],
					data_category: 'Sequencing Reads',
					object_id: '48300836-2bd3-5d5b-a288-e90b837bfe0c',
					file_name: 'DATA-CA.DO251215.SA612411.wgs.20230710.aln.cram',
					file_size: 98416,
					file_type: 'CRAM',
					md5sum: '1231017a77dfd0b615983db5bdcf0d14',

					data_type: 'Aligned Reads',
				},
			],
			repositories: [
				{
					code: 'argo.dev',
					country: 'Canada',
					name: 'ARGO Dev',
					organization: 'OICR',
					url: `https://api.rdpc-dev.cumulus.genomeinformatics.org/graphql`,
				},
			],
			analysis_state: 'PUBLISHED',
			analysis_type: 'sequencing_alignment',
			analysis_version: 6,
			experiment: {
				platform: 'ILLUMINA',
				platform_model: 'Illumina HiSeq X',
				sequencing_date: '2022-12-12',
				sequencing_center: 'ARGO',
				experimental_strategy: 'WGS',
				submitter_sequencing_experiment_id: 'ujolwwdsmgN2',
			},
			file_access: 'controlled',
			first_published_at: '2024-01-19T14:58:09.830639',
			workflow: {
				inputs: [
					{
						analysis_type: 'sequencing_experiment',
						input_analysis_id: 'aa8a05d9-ca93-463b-8a05-d9ca93763b58',
					},
				],
				run_id: 'wes-899ba5c83229418eb032a0bbe91f35f9',
				session_id: '5e9ea525-5fd0-49e1-8633-ad284b126b07',
				genome_build: 'GRCh38_hla_decoy_ebv',
				workflow_name: 'DNA Seq Alignment',
				workflow_version: '1.9.2',
			},
			read_groups: [
				{
					file_r1: 'TEST_SUBMITTER_SPECIMEN_ID_ujolwwdsmgN2.0.R1.fastq.gz',
					file_r2: null,
					insert_size: null,
					library_name: 'WGS:ujolwwdsmgN2',
					is_paired_end: false,
					platform_unit: 'ujolwwdsmgN2_0',
					read_length_r1: 150,
					read_length_r2: null,
					sample_barcode: 'NNNNNN',
					read_group_id_in_bam: null,
					submitter_read_group_id: 'ujolwwdsmgN2_0',
				},
			],
			read_group_count: 1,
		},
	],
	specimens: [
		{
			samples: [
				{
					sample_type: 'Total DNA',
					submitter_sample_id: 'SL835',
					sample_id: 'SA626580',
				},
				{
					sample_type: 'Total DNA',
					submitter_sample_id: 'BL201',
					sample_id: 'SA626590',
				},
			],

			program_id: 'TEST-CA',
			submitter_donor_id: 'donor-155',
			submitter_specimen_id: 'BL97',
			submitter_primary_diagnosis_id: 'PD300',
			pathological_tumour_staging_system: undefined,
			pathological_t_category: undefined,
			pathological_n_category: undefined,
			pathological_m_category: undefined,
			pathological_stage_group: undefined,
			specimen_acquisition_interval: 23,
			tumour_histological_type: undefined,
			specimen_anatomic_location: 'C49.4',
			specimen_laterality: 'Left',
			specimen_processing: 'Fresh',
			specimen_storage: 'Frozen in liquid nitrogen',
			reference_pathology_confirmed: undefined,
			tumour_grading_system: undefined,
			tumour_grade: undefined,
			percent_tumour_cells_measurement_method: undefined,
			percent_tumour_cells: undefined,
			percent_proliferating_cells: undefined,
			percent_inflammatory_tissue: undefined,
			percent_stromal_cells: undefined,
			percent_necrosis: undefined,

			specimen_tissue_source: 'Blood derived',
			tumour_normal_designation: 'Normal',
			specimen_type: 'Normal',
			specimen_id: 'SP226561',
		},
		{
			samples: [
				{
					sample_id: 'SA626579',
					sample_type: 'Total DNA',
					submitter_sample_id: 'SL896',
				},
			],

			program_id: 'TEST-CA',
			submitter_donor_id: 'donor-155',
			submitter_specimen_id: 'TU245',
			submitter_primary_diagnosis_id: 'PD300',
			pathological_tumour_staging_system: 'AJCC 8th edition',
			pathological_t_category: 'T3',
			pathological_n_category: 'N0',
			pathological_m_category: 'Not applicable',
			pathological_stage_group: 'Stage I',
			specimen_acquisition_interval: 31,
			tumour_histological_type: '9064/2',
			specimen_anatomic_location: 'C49.4',
			specimen_laterality: 'Left',
			specimen_processing: undefined,
			specimen_storage: 'Frozen in liquid nitrogen',
			reference_pathology_confirmed: 'Yes',
			tumour_grading_system: 'Three-tier grading system',
			tumour_grade: 'G3',
			percent_tumour_cells_measurement_method: 'Genomics',
			percent_tumour_cells: 0.65,
			percent_proliferating_cells: undefined,
			percent_inflammatory_tissue: undefined,
			percent_stromal_cells: undefined,
			percent_necrosis: undefined,

			specimen_tissue_source: 'Solid tissue',
			tumour_normal_designation: 'Tumour',
			specimen_type: 'Primary tumour',
			specimen_id: 'SP226562',
		},
	],

	submitter_donor_id: 'donor-155',
	vital_status: 'Deceased',
	cause_of_death: 'Died of cancer',
	survival_time: 1556,
	primary_site: ['Breast'],
	height: undefined,
	weight: undefined,
	bmi: undefined,
	genetic_disorders: ['Lynch Syndrome'],
	menopause_status: 'Postmenopausal',
	age_at_menarche: undefined,
	number_of_pregnancies: 2,
	number_of_children: 2,
	hrt_type: undefined,
	hrt_duration: undefined,
	contraception_type: undefined,
	contraception_duration: undefined,
};
