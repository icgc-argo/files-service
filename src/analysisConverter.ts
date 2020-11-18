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
    headers: { 'Content-Type': 'application/json' },
  });
  if (result.status != 201) {
    logger.error(`response from converter: ${await result.text()}`);
    throw new Error(`failed to convert files, got response ${result.status}`);
  }
  const response = await result.json();

  return response;
}
