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

import { expect } from 'chai';
import { StartedTestContainer, Wait, GenericContainer } from 'testcontainers';
import { Client } from '@elastic/elasticsearch';
import { AnalysisUpdateEvent } from '../entity';
import * as manager from '../manager';
import nock from 'nock';
import * as db from '../dbConnection';
import { getAppConfig } from '../config';
const ES_PORT = 9200;

describe('manager', () => {
  let esClient: Client;
  let esContainer: StartedTestContainer;
  let mongoContainer: StartedTestContainer;

  const startContainers = async () => {
    esContainer = await new GenericContainer('elasticsearch', '7.5.0')
      .withExposedPorts(ES_PORT)
      .withEnv('discovery.type', 'single-node')
      .withEnv('http.port', `${ES_PORT}`)
      .withHealthCheck({
        test: `curl -f http://localhost:${ES_PORT} || exit 1`, // this is executed inside the container
        startPeriod: 10000,
        retries: 5,
        interval: 2000,
        timeout: 5000,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .start();
    mongoContainer = await new GenericContainer('mongo', '4.0').withExposedPorts(27017).start();
  };

  before(async () => {
    const config = await getAppConfig('./src/test/.env.test');
    nock('http://maestro.org')
      .post(`/convert`)
      .reply(201, convertedAnalysisResponse);
    try {
      await startContainers();
      const ES_HOST = `http://${esContainer.getHost()}:${esContainer.getMappedPort(ES_PORT)}`;
      esClient = new Client({
        node: ES_HOST,
      });
      config.elasticProperties.node = ES_HOST;
      config.mongoProperties.dbUrl = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(
        27017,
      )}/files`;
      db.connectDb(config);
    } catch (err) {
      console.error('failed to setup test environment', err);
      await esContainer.stop();
    }
  });

  after(async () => {
    await esContainer.stop();
  });

  it('can handle published analysis event', async () => {
    const result = await manager.handleAnalysisPublishEvent(analysisEvent);
    const id = result[0];
    const getFileById = await esClient.get({
      id: '4b509876-3f0d-57ae-b097-50d892bf268e',
      index: 'file_centric_test',
    });

    console.log(`response: ${JSON.stringify(getFileById.body)}`);
    expect(getFileById.body._id).to.eq('4b509876-3f0d-57ae-b097-50d892bf268e');
    expect(getFileById.body).to.deep.eq(expectedResult);
  });
});

const expectedResult = {
  _index: 'file_centric_test',
  _type: '_doc',
  _id: '4b509876-3f0d-57ae-b097-50d892bf268e',
  _version: 1,
  _seq_no: 0,
  _primary_term: 1,
  found: true,
  _source: {
    analysis: {
      experiment: {
        variant_calling_tool: 'silver bullet',
        matched_normal_sample_submitter_id: 'sample_x24_11a',
      },
      info: {
        description: 'This is extra info in a JSON format',
      },
      analysis_id: '11d1cf85-4d3d-4aea-91cf-854d3deaea1d',
      analysis_type: 'variantCall',
      analysis_version: 1,
      analysis_state: 'PUBLISHED',
      analysis_state_history: [
        {
          initial_state: 'UNPUBLISHED',
          updated_state: 'PUBLISHED',
          updated_at: '2020-12-02T17:18:32.353334',
        },
      ],
      created_at: '2020-12-02T17:18:32.353334',
      first_published_at: '2020-12-02T17:18:32.353334',
      published_at: '2020-12-02T17:18:32.353334',
      updated_at: '2020-12-02T17:18:32.353334',
    },
    file: {
      name: 'example.vcf.gz',
      md5sum: '9a793e90d0d1e11301ea8da996446e59',
      size: 52,
      data_type: 'SOME_DATA_TYPE',
      index_file: {
        name: 'example.vcf.gz.idx',
        md5sum: 'c03274816eb4907a92b8e5632cd6eb81',
        size: 25,
        object_id: '2b8500d1-c9ce-5146-b1e6-5b3e318b3851',
        file_type: 'IDX',
        data_type: 'robdatatype4',
      },
    },
    repositories: [
      {
        code: 'song.collab',
        organization: 'rdpc-collab',
        name: 'Cancer Genome Collaboratory',
        type: 'S3',
        country: 'CA',
        url: 'https://song.rdpc-dev.cancercollaboratory.org',
      },
    ],
    donors: [
      {
        gender: 'Female',
        specimens: [
          {
            samples: [
              {
                sample_id: 'SA610224',
                submitter_sample_id: 'DEMO_SA_1',
                sample_type: 'Total RNA',
                matched_normal_submitter_sample_id: 'sample_x24_11a',
              },
            ],
            specimen_id: 'SP210197',
            specimen_type: 'Primary tumour',
            submitter_specimen_id: 'DEMO_SP_1',
            tumour_normal_designation: 'Tumour',
            specimen_tissue_source: 'Solid tissue',
          },
        ],
        donor_id: 'DO250179',
        submitter_donor_id: 'DEMO_DO_1',
      },
    ],
    object_id: '4b509876-3f0d-57ae-b097-50d892bf268e',
    study_id: 'TEST-CA',
    data_type: 'SOME_DATA_TYPE',
    file_type: 'VCF',
    file_access: 'open',
    file_id: 'FL1',
  },
};

const convertedAnalysisResponse = {
  '11d1cf85-4d3d-4aea-91cf-854d3deaea1d': [
    {
      objectId: '4b509876-3f0d-57ae-b097-50d892bf268e',
      studyId: 'TEST-CA',
      dataType: 'SOME_DATA_TYPE',
      fileType: 'VCF',
      fileAccess: 'open',
      analysis: {
        analysisId: '11d1cf85-4d3d-4aea-91cf-854d3deaea1d',
        analysisType: 'variantCall',
        analysisVersion: 1,
        analysisState: 'PUBLISHED',
        experiment: {
          variantCallingTool: 'silver bullet',
          matchedNormalSampleSubmitterId: 'sample_x24_11a',
        },
        analysisStateHistory: [
          {
            initialState: 'UNPUBLISHED',
            updatedState: 'PUBLISHED',
            updatedAt: '2020-12-02T17:18:32.353334',
          },
        ],
        createdAt: '2020-12-02T17:18:32.353334',
        firstPublishedAt: '2020-12-02T17:18:32.353334',
        info: {
          description: 'This is extra info in a JSON format',
        },
        publishedAt: '2020-12-02T17:18:32.353334',
        updatedAt: '2020-12-02T17:18:32.353334',
      },
      file: {
        name: 'example.vcf.gz',
        md5sum: '9a793e90d0d1e11301ea8da996446e59',
        size: 52,
        dataType: 'SOME_DATA_TYPE',
        indexFile: {
          objectId: '2b8500d1-c9ce-5146-b1e6-5b3e318b3851',
          name: 'example.vcf.gz.idx',
          fileType: 'IDX',
          md5sum: 'c03274816eb4907a92b8e5632cd6eb81',
          dataType: 'robdatatype4',
          size: 25,
        },
      },
      repositories: [
        {
          code: 'song.collab',
          organization: 'rdpc-collab',
          name: 'Cancer Genome Collaboratory',
          type: 'S3',
          country: 'CA',
          url: 'https://song.rdpc-dev.cancercollaboratory.org',
        },
      ],
      donors: [
        {
          donorId: 'DO250179',
          submitterDonorId: 'DEMO_DO_1',
          gender: 'Female',
          specimens: [
            {
              specimenId: 'SP210197',
              specimenType: 'Primary tumour',
              submitterSpecimenId: 'DEMO_SP_1',
              samples: [
                {
                  sampleId: 'SA610224',
                  submitterSampleId: 'DEMO_SA_1',
                  sampleType: 'Total RNA',
                  matchedNormalSubmitterSampleId: 'sample_x24_11a',
                },
              ],
              tumourNormalDesignation: 'Tumour',
              specimenTissueSource: 'Solid tissue',
            },
          ],
        },
      ],
    },
  ],
};

const analysisEvent: AnalysisUpdateEvent = {
  songServerId: 'song.collabz',
  analysis: {
    analysisId: '11d1cf85-4d3d-4aea-91cf-854d3deaea1d',
    studyId: 'TEST-CA',
    analysisState: 'PUBLISHED',
    createdAt: '2020-12-02T17:18:32.353334',
    updatedAt: '2020-12-02T17:18:32.353334',
    firstPublishedAt: '2020-12-02T17:18:32.353334',
    publishedAt: '2020-12-02T17:18:32.353334',
    analysisStateHistory: [
      {
        initialState: 'UNPUBLISHED',
        updatedState: 'PUBLISHED',
        updatedAt: '2020-12-02T17:18:32.353334',
      },
    ],
    samples: [
      {
        sampleId: 'SA610224',
        specimenId: 'SP210197',
        submitterSampleId: 'DEMO_SA_1',
        matchedNormalSubmitterSampleId: 'sample_x24_11a',
        sampleType: 'Total RNA',
        specimen: {
          specimenId: 'SP210197',
          donorId: 'DO250179',
          submitterSpecimenId: 'DEMO_SP_1',
          tumourNormalDesignation: 'Tumour',
          specimenTissueSource: 'Solid tissue',
          specimenType: 'Primary tumour',
        },
        donor: {
          donorId: 'DO250179',
          studyId: 'TEST-CA',
          gender: 'Female',
          submitterDonorId: 'DEMO_DO_1',
        },
      },
    ],
    files: [
      {
        objectId: '4b509876-3f0d-57ae-b097-50d892bf268e',
        studyId: 'TEST-CA',
        analysisId: '11d1cf85-4d3d-4aea-91cf-854d3deaea1d',
        fileName: 'example.vcf.gz',
        fileSize: 52,
        fileType: 'VCF',
        fileMd5sum: '9a793e90d0d1e11301ea8da996446e59',
        fileAccess: 'open',
        dataType: 'SOME_DATA_TYPE',
      },
      {
        objectId: '2b8500d1-c9ce-5146-b1e6-5b3e318b3851',
        studyId: 'TEST-CA',
        analysisId: '11d1cf85-4d3d-4aea-91cf-854d3deaea1d',
        fileName: 'example.vcf.gz.idx',
        fileSize: 25,
        fileType: 'IDX',
        fileMd5sum: 'c03274816eb4907a92b8e5632cd6eb81',
        fileAccess: 'open',
        dataType: 'robdatatype4',
      },
    ],
    analysisType: {
      name: 'variantCall',
      version: 1,
    },
    info: {
      description: 'This is extra info in a JSON format',
    },
    experiment: {
      variantCallingTool: 'silver bullet',
      matchedNormalSampleSubmitterId: 'sample_x24_11a',
    },
  },
};
