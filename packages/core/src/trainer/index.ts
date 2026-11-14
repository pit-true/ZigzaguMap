// trainer の公開する名前（#244 トレーナーの表、#245 trainers.json と自動生成）。
export {
  PARTY_FLAG_CUSTOM_MOVES,
  PARTY_FLAG_HAS_ITEM,
  TRAINER_CLASS_COUNT,
  TRAINER_CLASS_NAMES_POINTER,
  TRAINER_COUNT,
  TRAINER_ID_MAX,
  TRAINER_NAME_BYTES,
  TRAINER_SIZE,
  TRAINER_TABLE_POINTER,
  TrainerTable,
  decodeTrainer,
  summaryOf,
  trainerMonSize,
  type TrainerData,
  type TrainerMon,
  type TrainerSummary,
} from "./TrainerTable.js";
export {
  TRAINERS_JSON_FORMAT,
  TRAINERS_JSON_PATH,
  TRAINER_PARTY_MAX,
  TrainersProject,
  checkTrainerEntry,
  cloneTrainer,
  parseTrainersJson,
  stringifyTrainersJson,
  type TrainerEntry,
} from "./TrainersJson.js";
export {
  RemoveTrainerCommand,
  SetTrainerCommand,
  registerTrainerCommands,
  trainerFromArgs,
  withTrainers,
  type RemoveTrainerArgs,
  type SetTrainerArgs,
  type TrainersContext,
} from "./TrainerCommands.js";
export { generateTeam, seededRandom, wildCandidates, type GeneratedTeam, type WildCandidate } from "./TeamGenerator.js";
