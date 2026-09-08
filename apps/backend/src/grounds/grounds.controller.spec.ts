import { Test, TestingModule } from '@nestjs/testing';
import { GroundsController } from './grounds.controller';

describe('GroundsController', () => {
  let controller: GroundsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroundsController],
    }).compile();

    controller = module.get<GroundsController>(GroundsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
