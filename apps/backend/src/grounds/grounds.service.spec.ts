import { Test, TestingModule } from '@nestjs/testing';
import { GroundsService } from './grounds.service';

describe('GroundsService', () => {
  let service: GroundsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GroundsService],
    }).compile();

    service = module.get<GroundsService>(GroundsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
