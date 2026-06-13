-- Additive: User.zuperUserUid + CrewMember.userId link
ALTER TABLE "User" ADD COLUMN "zuperUserUid" TEXT;
ALTER TABLE "CrewMember" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "CrewMember_userId_key" ON "CrewMember"("userId");
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
