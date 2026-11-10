import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  ddb,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }

  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }
  try {
    const movieResult = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: movieKey(movieId), SK: movieKey(movieId) },
      })
    );
    if (!movieResult.Item) {
      return response(404, { message: `Movie ${movieId} not found` });
    }

    let commandInput: QueryCommandInput = {
      TableName: tableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": movieKey(movieId) },
    };
    if (actorId !== undefined) {
      commandInput = {
        ...commandInput,
        KeyConditionExpression: "PK = :pk and SK = :sk",
        ExpressionAttributeValues: { ":pk": movieKey(movieId), ":sk": actorKey(actorId) },
      };
    }
    const queryResult = await ddb.send(new QueryCommand(commandInput));

    const resultItems = queryResult.Items ?? [];
    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};
