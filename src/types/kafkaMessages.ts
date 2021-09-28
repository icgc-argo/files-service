export type PublicReleaseMessage = {
  id: string;
  publishedAt: Date;
  label: string;
  programs: Program[];
};

export type Program = {
  id: string;
  donorsUpdated: string[];
};
