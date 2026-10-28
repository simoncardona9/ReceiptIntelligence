export interface DatabaseHealthPort {
  isAvailable(): Promise<boolean>;
}
