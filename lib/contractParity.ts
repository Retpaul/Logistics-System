// Compile-time guard: the shared contract enums must equal the Prisma enums.
// If someone changes one without the other, `npm run typecheck` fails on this file.
import type { $Enums } from "@prisma/client";
import type { OrderStatus, PackageSize, PaymentStatus, Role } from "../contracts/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type ContractParity = [
  Assert<Equal<OrderStatus, $Enums.OrderStatus>>,
  Assert<Equal<Role, $Enums.Role>>,
  Assert<Equal<PaymentStatus, $Enums.PaymentStatus>>,
  Assert<Equal<PackageSize, $Enums.PackageSize>>,
];
