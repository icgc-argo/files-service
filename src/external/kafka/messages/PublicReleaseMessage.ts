import { Program } from '../publicReleaseProducer';

type PublicReleaseMessage = {
  id: string;
  publishedAt: Date;
  label: string;
  programs: Program[];
};

export default PublicReleaseMessage;
