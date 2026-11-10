import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

const isId = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  const { movieId, actorId, roleName, roleDescription } = body;
  if (!isId(movieId) || !isId(actorId) || !isText(roleName) || !isText(roleDescription)) {
    return response(400, {
      message:
        "movieId and actorId must be positive integers; roleName and roleDescription must be non-empty strings",
    });
  }
  const role: Role = { movieId, actorId, roleName, roleDescription };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: { PK: movieKey(role.movieId), SK: actorKey(role.actorId), ...role },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );

    return response(201, { message: "Role added", data: role });
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const [noMovie, noActor, duplicate] = (err.CancellationReasons ?? []).map(
        (reason) => reason.Code === "ConditionalCheckFailed"
      );
      if (noMovie) return response(404, { message: `Movie ${role.movieId} not found` });
      if (noActor) return response(404, { message: `Actor ${role.actorId} not found` });
      if (duplicate) {
        return response(409, { message: `Actor ${role.actorId} already has a role in movie ${role.movieId}` });
      }
    }
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};
