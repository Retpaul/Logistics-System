import bcrypt from "bcrypt";

const COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Compared against when no user matches, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-password", COST);
export const burnPasswordCheck = (plain: string) => bcrypt.compare(plain, DUMMY_HASH);
