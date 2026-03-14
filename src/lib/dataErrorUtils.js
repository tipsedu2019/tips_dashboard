export function getUserFriendlyDataError(error, fallback = '알 수 없는 오류가 발생했습니다.') {
  const message = String(error?.message || '').trim();
  if (!message) {
    return fallback;
  }

  const lower = message.toLowerCase();

  if (lower.includes('null value in column "id"')) {
    return '새 항목 ID를 만들지 못해 저장에 실패했습니다. 다시 시도해 주세요.';
  }

  if (lower.includes('schema cache') || lower.includes('could not find the')) {
    return 'Supabase 최신 테이블 또는 컬럼 설정이 아직 반영되지 않았습니다. SQL Editor에서 최신 마이그레이션을 먼저 실행해 주세요.';
  }

  if (lower.includes('permission denied') || lower.includes('row-level security')) {
    return '권한이 없어 저장할 수 없습니다. staff/admin 계정인지, 또는 Supabase RLS 정책이 올바른지 확인해 주세요.';
  }

  if (lower.includes('academic_supplement_materials_profile_id_fkey')) {
    return '기존 학사 교과 정보와 부교재 연결 정보가 충돌했습니다. 다시 시도해 주세요. 계속되면 관리자에게 데이터 정합성 점검이 필요합니다.';
  }

  if (lower.includes('foreign key constraint')) {
    return '연결된 데이터 관계가 맞지 않아 저장하지 못했습니다. 다시 시도해 주세요.';
  }

  if (lower.includes('violates not-null constraint')) {
    return '필수 입력값이 비어 있어 저장하지 못했습니다.';
  }

  if (lower.includes('duplicate key')) {
    return '같은 이름 또는 같은 기준의 데이터가 이미 있어 저장하지 못했습니다.';
  }

  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return '네트워크 연결이 불안정해 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }

  return message;
}
