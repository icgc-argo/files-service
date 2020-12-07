import { expect } from 'chai';
import '../app';
import {
  GenericContainer,
  StartedTestContainer,
  Wait,
  DockerComposeEnvironment,
  StartedDockerComposeEnvironment,
} from 'testcontainers';
import { Client } from '@elastic/elasticsearch';
import { beforeEach } from 'mocha';
const ES_PORT = 2358;

describe('manager', () => {
  let environment: StartedDockerComposeEnvironment;
  let esClient: Client;
  beforeEach(async () => {
    try {
      environment = await new DockerComposeEnvironment(__dirname, 'test-compose.yaml')
        .withWaitStrategy('test_fs_es', Wait.forHealthCheck())
        .up();
      const esContainer = environment.getContainer('test_fs_es') as StartedTestContainer;
      const ES_MAPPED_HOST = `http://${esContainer.getHost()}`;
      const ES_HOST = `${ES_MAPPED_HOST}:${ES_PORT}`;
      console.log(`>>>>>>>>>> ${ES_HOST}`);
      console.log(`>>>>>>>>>> ${esContainer.getName()}`);
      esClient = new Client({
        node: ES_HOST,
      });
    } catch (err) {
      console.log('brfore >>>>>>>>>>>>', err);
    }
  });

  afterEach(async () => {
    await environment.down();
  });

  it('works', async () => {
    const res = await esClient.ping();
    expect(res.statusCode).to.eq(200);
  });
});
