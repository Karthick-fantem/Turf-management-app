import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding Database...');

  // 0. Create a dummy Turf Owner
  let owner = await prisma.user.findFirst({ where: { phone: '0000000000' } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        phone: '0000000000',
        role: 'TURF_OWNER',
        name: 'Admin Owner',
      },
    });
  }

  // 1. Create a Turf
  let turf1 = await prisma.turf.findFirst({ where: { name: 'Madurai Sports Arena' } });
  if (!turf1) {
    turf1 = await prisma.turf.create({
      data: {
        ownerId: owner.id,
        name: 'Madurai Sports Arena',
        address: '123 Bypass Road, Madurai',
        description: 'Premium sports facility with multiple grounds.',
      },
    });
  }

  let turf2 = await prisma.turf.findFirst({ where: { name: 'Anna Nagar Turf' } });
  if (!turf2) {
    turf2 = await prisma.turf.create({
      data: {
        ownerId: owner.id,
        name: 'Anna Nagar Turf',
        address: 'Anna Nagar 1st Street, Madurai',
        description: 'Excellent turf for 5v5 football.',
      },
    });
  }

  // 2. Create Grounds for Turf 1
  let ground1 = await prisma.ground.findFirst({ where: { name: 'Main Football Ground', turfId: turf1.id } });
  if (!ground1) {
    ground1 = await prisma.ground.create({
      data: {
        name: 'Main Football Ground',
        sport: 'Football',
        price: 1500,
        turfId: turf1.id,
      },
    });
  }

  let ground2 = await prisma.ground.findFirst({ where: { name: 'Cricket Nets', turfId: turf1.id } });
  if (!ground2) {
    ground2 = await prisma.ground.create({
      data: {
        name: 'Cricket Nets',
        sport: 'Cricket',
        price: 800,
        turfId: turf1.id,
      },
    });
  }

  // 3. Create Grounds for Turf 2
  let ground3 = await prisma.ground.findFirst({ where: { name: '5v5 Astro Turf', turfId: turf2.id } });
  if (!ground3) {
    ground3 = await prisma.ground.create({
      data: {
        name: '5v5 Astro Turf',
        sport: 'Football',
        price: 1200,
        turfId: turf2.id,
      },
    });
  }

  // 4. Create TimeSlots (for today and tomorrow)
  const today = new Date();
  today.setHours(0, 0, 0, 0); // start of day

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Asia/Kolkata = UTC+5:30. We store slot times in UTC.
  // A time like "06:00 IST" = "00:30 UTC"
  const IST_OFFSET_HOURS = 5.5;

  /**
   * Create a TimeSlot using IST wall-clock times.
   * startTimeStr and endTimeStr are "HH:MM" in Asia/Kolkata.
   * date is a JS Date representing the IST calendar day (we use its UTC date parts).
   */
  const createSlot = async (
    groundId: string,
    startTimeStr: string,
    endTimeStr: string,
    date: Date,
    price: number,
  ) => {
    const [startH, startM] = startTimeStr.split(':').map(Number);
    const [endH, endM] = endTimeStr.split(':').map(Number);

    // Build IST DateTime then convert to UTC for storage
    const istDay = new Date(date);
    const startIst = new Date(
      Date.UTC(
        istDay.getUTCFullYear(), istDay.getUTCMonth(), istDay.getUTCDate(),
        startH, startM, 0, 0,
      ) - IST_OFFSET_HOURS * 60 * 60 * 1000,
    );
    const endIst = new Date(
      Date.UTC(
        istDay.getUTCFullYear(), istDay.getUTCMonth(), istDay.getUTCDate(),
        endH, endM, 0, 0,
      ) - IST_OFFSET_HOURS * 60 * 60 * 1000,
    );

    const existing = await prisma.timeSlot.findFirst({
      where: { groundId, startTime: startIst, endTime: endIst },
    });

    if (!existing) {
      await prisma.timeSlot.create({
        data: { groundId, startTime: startIst, endTime: endIst, price, isBlocked: false },
      });
    }
  };

  // Reference dates (treated as IST calendar dates)
  const todayIst = new Date(); // server time — not critical for seed

  // Named Module 2 seed date: 2026-09-10 (IST)
  const sept10Ist = new Date(Date.UTC(2026, 8, 10)); // 2026-09-10 00:00 UTC as proxy for IST day

  // Create slots for Ground 1 — today
  await createSlot(ground1.id, '18:00', '19:00', todayIst, 1500);
  await createSlot(ground1.id, '19:00', '20:00', todayIst, 1500);
  await createSlot(ground1.id, '20:00', '21:00', todayIst, 1500);

  // Ground 1 — tomorrow
  const tomorrowIst = new Date(todayIst.getTime() + 24 * 60 * 60 * 1000);
  await createSlot(ground1.id, '18:00', '19:00', tomorrowIst, 1500);
  await createSlot(ground1.id, '19:00', '20:00', tomorrowIst, 1500);

  // Ground 1 — 2026-09-10 IST (Module 2 reference date)
  await createSlot(ground1.id, '06:00', '07:00', sept10Ist, 1000);
  await createSlot(ground1.id, '07:00', '08:00', sept10Ist, 1200);
  await createSlot(ground1.id, '18:00', '19:00', sept10Ist, 1500);

  // Ground 2 — today
  await createSlot(ground2.id, '06:00', '08:00', todayIst, 800);
  await createSlot(ground2.id, '16:00', '18:00', todayIst, 800);

  // Ground 3 — today
  await createSlot(ground3.id, '17:00', '18:00', todayIst, 1200);
  await createSlot(ground3.id, '18:00', '19:00', todayIst, 1200);


  // 5. Create a Game Lobby for testing
  let host = await prisma.user.findFirst({ where: { phone: '1111111111' } });
  if (!host) {
    host = await prisma.user.create({
      data: { phone: '1111111111', role: 'PLAYER', name: 'Lobby Host' },
    });
  }

  const slotForGame = await prisma.timeSlot.findFirst({ where: { groundId: ground1.id, startTime: { gt: new Date() } } });
  if (slotForGame) {
    const existingGame = await prisma.game.findFirst({ where: { slotId: slotForGame.id } });
    if (!existingGame) {
      await prisma.game.create({
        data: {
          hostId: host.id,
          sport: 'Football',
          slotId: slotForGame.id,
          minPlayers: 4,
          maxPlayers: 10,
          pricePerPlayer: 150,
          visibility: 'PUBLIC',
          players: {
            create: {
              userId: host.id,
              status: 'JOINED'
            }
          }
        }
      });
    }
  }

  console.log('Database Seeding Completed Successfully! 🌱');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
