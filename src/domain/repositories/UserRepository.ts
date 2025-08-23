// src/domain/repositories/UserRepository.ts

import { User } from "../entities/User";

export interface UserRepository {
  save(user: User): Promise<void>;
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  update(user: User): Promise<void>;
}
