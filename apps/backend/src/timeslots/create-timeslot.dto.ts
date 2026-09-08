export class CreateTimeSlotDto {
  groundId: string;
  startTime: string; // ISO 8601 string
  endTime: string;   // ISO 8601 string
  price: number;
}

