export const ALL_FIELDS_COLLECTED_ACKNOWLEDGEMENT = 'Em đã nhận đủ thông tin. Bên em sẽ kiểm tra và phản hồi anh/chị sau nhé.';

export function composeOperatorTaskResponse(
  missingFields: string[],
  acknowledgementMessage?: string | null,
): string {
  if (missingFields.length === 0) {
    return acknowledgementMessage?.trim() || ALL_FIELDS_COLLECTED_ACKNOWLEDGEMENT;
  }

  return `Anh/chị cho em xin thêm ${joinFields(missingFields)} để em kiểm tra nhé.`;
}

function joinFields(fields: string[]): string {
  if (fields.length === 1) return fields[0];
  if (fields.length === 2) return `${fields[0]} và ${fields[1]}`;
  return `${fields.slice(0, -1).join(', ')} và ${fields[fields.length - 1]}`;
}
