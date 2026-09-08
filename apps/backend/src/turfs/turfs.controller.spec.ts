import { Test, TestingModule } from '@nestjs/testing';
import { TurfsController } from './turfs.controller';

describe('TurfsController', () => {
  let controller: TurfsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TurfsController],
    }).compile();

    controller = module.get<TurfsController>(TurfsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
