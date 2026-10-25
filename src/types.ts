export type Point3 = [number, number, number];

export interface PhotoRef {
  id: string;
  uri: string;
  name: string;
  source: 'gallery' | 'camera';
}

export interface Mark {
  id: string;
  part: string;
  point: Point3;
  action: string;
  severity: number;
  actors: string[];
}

export interface Followup {
  id: string;
  at: string;
  text: string;
  photos: PhotoRef[];
}

export interface DiaryEvent {
  id: string;
  at: string;
  place: string;
  description: string;
  marks: Mark[];
  photos: PhotoRef[];
  followups: Followup[];
  updatedAt: string;
}

export interface DiaryData {
  events: DiaryEvent[];
  createdAt: string;
}
