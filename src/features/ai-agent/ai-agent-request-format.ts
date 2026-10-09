export const AI_REQUEST_STATUS_LABELS = { pending: '대기', processing: '처리 중', question: '답변 필요', done: '완료', cancelled: '취소' };
export const aiRequestDate = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value));
