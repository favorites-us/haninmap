/**
 * Category Resolver: maps raw Korean category strings from StagedBusiness
 * to Category table IDs (primaryCategoryId, subcategoryId).
 *
 * StagedBusiness.primaryCategory contains raw Korean strings like
 * "부동산/모기지/보험/금융" from various crawl sources. This module
 * maps them to the taxonomy slugs defined in src/lib/taxonomy/categories.ts.
 */

import { PrismaClient } from '@prisma/client';

// ─── Raw Korean string → taxonomy slug mapping ──────────────────────────

const CRAWL_CATEGORY_MAPPING: Record<string, { primary: string; sub?: string }> = {
  // === Korea Times CA composite categories ===
  '식당/식품/제과점': { primary: 'food' },
  '의료/한의/약국': { primary: 'medical' },
  '쇼핑/웨딩/사진/의류': { primary: 'shopping' },
  '이민/교육/사무': { primary: 'education' },
  '전자/인터넷/컴퓨터': { primary: 'shopping', sub: 'electronics' },
  '부동산/모기지/보험/금융': { primary: 'real-estate' },
  '전문서비스/광고': { primary: 'professional' },
  '건설/인테리어/핸디맨': { primary: 'home-services', sub: 'construction' },
  '차량/운송/수리/렌탈': { primary: 'auto' },
  '스포츠/오락': { primary: 'community' },
  '법률/회계': { primary: 'legal' },
  '건강/미용/사우나/복지': { primary: 'beauty' },
  '여행/숙박/운송': { primary: 'travel' },
  '언론/종교/커뮤니티/한국기업': { primary: 'community' },
  '기타업종': { primary: 'community' },

  // === Vancouver Chosun categories ===
  '금융·회계·법률': { primary: 'financial' },
  '의료·한방·약국': { primary: 'medical' },
  '학교·학원': { primary: 'education', sub: 'tutoring' },
  '이민·유학': { primary: 'education' },
  '생활·미용': { primary: 'beauty' },
  '식당·식품': { primary: 'food' },
  '여행·숙박': { primary: 'travel' },
  '오락·스포츠': { primary: 'community' },
  '전자·통신': { primary: 'shopping', sub: 'electronics' },
  '건축·시공': { primary: 'home-services', sub: 'construction' },
  '자동차·정비': { primary: 'auto', sub: 'auto-repair' },
  '운송·이사': { primary: 'home-services', sub: 'moving' },
  '반려동물': { primary: 'community' },
  '전문서비스': { primary: 'professional' },
  '공공기관·단체': { primary: 'community', sub: 'organization' },
  '미디어·광고': { primary: 'professional', sub: 'advertising' },
  '클리닝': { primary: 'home-services', sub: 'cleaning' },

  // === BD CKTimes (Toronto JoongAng) individual categories ===
  '병원': { primary: 'medical' },
  '음식점': { primary: 'food', sub: 'korean-restaurant' },
  '식품점': { primary: 'food', sub: 'grocery' },
  '안경점': { primary: 'shopping', sub: 'optical' },
  '은행': { primary: 'financial', sub: 'bank' },
  '회계': { primary: 'financial', sub: 'cpa' },
  '여행사': { primary: 'travel', sub: 'travel-agency' },
  '변호사': { primary: 'legal' },
  '미용': { primary: 'beauty', sub: 'hair-salon' },
  '약국': { primary: 'medical', sub: 'pharmacy' },
  '사진': { primary: 'professional', sub: 'photography' },
  '냉동/난방': { primary: 'home-services', sub: 'hvac' },
  '냉동·난방': { primary: 'home-services', sub: 'hvac' },
  '언론기관': { primary: 'community', sub: 'media' },

  // === MissyCanada categories ===
  '생활식품': { primary: 'food', sub: 'grocery' },
  '한인식당': { primary: 'food', sub: 'korean-restaurant' },
  '미용/패션': { primary: 'beauty' },
  '건강의료': { primary: 'medical' },
  '여행레저': { primary: 'travel' },
  '금융/법률/회계': { primary: 'financial' },
  '기관/종교/단체': { primary: 'community' },
  '컴퓨터/통신': { primary: 'shopping', sub: 'electronics' },
  '이민/유학/학원': { primary: 'education' },
  '골프': { primary: 'community' },
  '운송/택배/이사': { primary: 'home-services', sub: 'moving' },
  '기타업체': { primary: 'community' },

  // === MoKorea categories (305 source categories) ===

  // ── Food & Dining ──
  '식당, 식품, 제과점': { primary: 'food' },
  '식당(all)': { primary: 'food' },
  '식당(한식)': { primary: 'food', sub: 'korean-restaurant' },
  '식당(중식)': { primary: 'food', sub: 'chinese-restaurant' },
  '식당(일식)': { primary: 'food', sub: 'japanese-restaurant' },
  '식당(기타)': { primary: 'food' },
  '식당(단란주점)': { primary: 'food' },
  '식품점,마켓': { primary: 'food', sub: 'grocery' },
  '제과점': { primary: 'food', sub: 'bakery' },
  '커피전문점, 요거트': { primary: 'food', sub: 'cafe' },
  '반찬집': { primary: 'food' },
  '캐더링': { primary: 'food' },
  '식품도매': { primary: 'food', sub: 'grocery' },
  '떡집,방앗간': { primary: 'food', sub: 'bakery' },
  '식당,상점장비': { primary: 'shopping' },
  '와이너리': { primary: 'food' },
  '농장,양식장,목장': { primary: 'food' },
  '유흥업소, 카페, 노래방': { primary: 'food' },
  '나이트 클럽': { primary: 'food' },
  '카페, 주점': { primary: 'food', sub: 'cafe' },

  // ── Medical ──
  '의료기관, 한방, 약국': { primary: 'medical' },
  '종합병원': { primary: 'medical' },
  '내과': { primary: 'medical', sub: 'internal-medicine' },
  '가정주치의': { primary: 'medical', sub: 'internal-medicine' },
  '소아과': { primary: 'medical', sub: 'pediatrics' },
  '산부인과': { primary: 'medical', sub: 'obgyn' },
  '비뇨기과': { primary: 'medical', sub: 'urology' },
  '외과': { primary: 'medical', sub: 'general-surgery' },
  '정형외과': { primary: 'medical', sub: 'orthopedics' },
  '신경흉곽외과': { primary: 'medical', sub: 'neurosurgery' },
  '이비인후과': { primary: 'medical', sub: 'ent' },
  '안과,검안과': { primary: 'medical', sub: 'ophthalmology' },
  '성형외과': { primary: 'medical', sub: 'plastic-surgery' },
  '신경,정신,심리치료': { primary: 'medical', sub: 'psychiatry' },
  '알러지과': { primary: 'medical', sub: 'allergy' },
  '피부과': { primary: 'medical', sub: 'dermatology' },
  '한방,침술원': { primary: 'medical', sub: 'korean-medicine' },
  '척추신경의': { primary: 'medical', sub: 'orthopedics' },
  '기타 의료기관': { primary: 'medical' },
  '의료기기': { primary: 'medical' },
  '노인과, 양로병원': { primary: 'medical' },
  '노화방지과': { primary: 'medical' },
  '방사선과': { primary: 'medical', sub: 'diagnostics' },
  '신경내과': { primary: 'medical' },
  '암전문': { primary: 'medical', sub: 'oncology' },
  '임상심리과': { primary: 'medical', sub: 'psychiatry' },
  '통증치료': { primary: 'medical', sub: 'pain-management' },
  '호흡기과': { primary: 'medical', sub: 'pulmonology' },
  '재활의학과': { primary: 'medical', sub: 'rehabilitation' },
  '발전문의': { primary: 'medical', sub: 'podiatry' },
  '수의사, 애완동물': { primary: 'community' },
  '상담,재활': { primary: 'medical', sub: 'rehabilitation' },

  // ── Dental ──
  '치과(all)': { primary: 'dental' },
  '교정치과': { primary: 'dental', sub: 'orthodontist' },
  '치아이식(임플란트)': { primary: 'dental', sub: 'dental-implants' },
  '보철치과': { primary: 'dental', sub: 'prosthodontist' },
  '치주치과': { primary: 'dental', sub: 'periodontist' },
  '소아치과': { primary: 'dental', sub: 'pediatric-dentist' },
  '치과기공': { primary: 'dental', sub: 'dental-lab' },
  '구강외과': { primary: 'dental' },

  // ── Real Estate ──
  '부동산, 융자, 보험, 은행': { primary: 'real-estate' },
  '상업용 부동산': { primary: 'real-estate', sub: 'commercial-realtor' },
  '에스크로': { primary: 'real-estate', sub: 'escrow' },
  '홈 스테이징': { primary: 'real-estate' },
  '홈 인스팩션': { primary: 'real-estate' },

  // ── Financial ──
  '융자': { primary: 'financial', sub: 'mortgage-broker' },
  '크레딧카드 서비스': { primary: 'financial' },
  '재정, 투자상담': { primary: 'financial', sub: 'financial-advisor' },
  '환전, 책캐싱': { primary: 'financial' },
  '공인회계사': { primary: 'financial', sub: 'cpa' },
  '세무사': { primary: 'financial', sub: 'tax-preparer' },
  '전당포,수표교환': { primary: 'financial' },
  '투자 및 금융': { primary: 'financial', sub: 'financial-advisor' },

  // ── Legal ──
  '법률, 회계, 공증, 변리': { primary: 'legal' },
  '변호사(이민)': { primary: 'legal', sub: 'immigration-lawyer' },
  '변호사(상해/사고)': { primary: 'legal', sub: 'personal-injury-lawyer' },
  '변호사(상법)': { primary: 'legal', sub: 'business-lawyer' },
  '변호사(가정법, 이혼)': { primary: 'legal', sub: 'family-lawyer' },
  '법무사/법률서비스': { primary: 'legal' },
  '공증': { primary: 'legal', sub: 'notary' },
  '변리사': { primary: 'legal' },
  '보석금': { primary: 'legal' },

  // ── Insurance ──
  // '보험' already in shared simple

  // ── Home Services ──
  '건축, 수리 및 청소': { primary: 'home-services' },
  '건축,설계': { primary: 'home-services', sub: 'construction' },
  '목공,집수리': { primary: 'home-services', sub: 'construction' },
  '페인트,도배': { primary: 'home-services', sub: 'painting' },
  '카펫, 마루, 타일': { primary: 'home-services', sub: 'carpet' },
  '청소,카펫 클리닝,소독': { primary: 'home-services', sub: 'cleaning' },
  '냉동,히팅': { primary: 'home-services', sub: 'hvac' },
  '플러밍(배관)': { primary: 'home-services', sub: 'plumbing' },
  '전기공사, 조명': { primary: 'home-services', sub: 'electrical' },
  '루핑': { primary: 'home-services', sub: 'roofing' },
  '정원공사,조경': { primary: 'home-services', sub: 'landscaping' },
  '핸디맨': { primary: 'home-services' },
  '커텐, 블라인드,셔터': { primary: 'home-services' },
  '그라지도어': { primary: 'home-services' },
  '유리(창문,유리제품)': { primary: 'home-services' },
  '페스트 컨트롤': { primary: 'home-services', sub: 'pest-control' },
  '수영장 청소': { primary: 'home-services', sub: 'cleaning' },
  '건축자재,하드웨어': { primary: 'home-services', sub: 'construction' },
  '조명기구': { primary: 'home-services', sub: 'electrical' },
  '철공,용접,판금': { primary: 'home-services', sub: 'construction' },
  '리사이클': { primary: 'home-services' },
  '이사(로컬, 장거리, 귀국)': { primary: 'home-services', sub: 'moving' },
  '택배,운송,통관': { primary: 'home-services', sub: 'moving' },
  '열쇠,금고,도장': { primary: 'home-services', sub: 'locksmith' },
  '세탁소,옷수선': { primary: 'home-services', sub: 'cleaning' },

  // ── Beauty ──
  '미용실, 사우나, 스킨케어': { primary: 'beauty' },
  '찜질방,대중사우나': { primary: 'beauty', sub: 'spa' },
  '스킨케어,영구화장': { primary: 'beauty', sub: 'skin-care' },
  '사우나,스파': { primary: 'beauty', sub: 'spa' },
  '지압, 마사지': { primary: 'beauty', sub: 'spa' },
  '미용용품': { primary: 'beauty', sub: 'cosmetics' },

  // ── Auto ──
  '자동차 판매, 정비, 운전학교': { primary: 'auto' },
  '자동차 판매': { primary: 'auto', sub: 'car-dealer' },
  '자동차 정비': { primary: 'auto', sub: 'auto-repair' },
  '자동차 바디 수리': { primary: 'auto', sub: 'body-shop' },
  '자동차유리,틴트,알람': { primary: 'auto' },
  '자동차 용품': { primary: 'auto' },
  '세차, 디테일': { primary: 'auto', sub: 'car-wash' },
  '운전학교': { primary: 'education', sub: 'driving-school' },
  '자동차부속': { primary: 'auto' },
  '폐차': { primary: 'auto' },
  '자전거,오토바이 판매 수리': { primary: 'auto' },
  '랜트카': { primary: 'auto', sub: 'car-rental' },

  // ── Shopping ──
  '쇼핑(쇼핑몰, 안경, 정수기)': { primary: 'shopping' },
  '쇼핑몰, 아울렛': { primary: 'shopping' },
  '선물센타': { primary: 'shopping' },
  '안경원': { primary: 'shopping', sub: 'optical' },
  '보석상': { primary: 'shopping', sub: 'jewelry' },
  '정수기,비데,공기청정기': { primary: 'shopping', sub: 'electronics' },
  '건강식품': { primary: 'shopping' },
  '건강용품': { primary: 'shopping' },
  '꽃집,화원': { primary: 'shopping', sub: 'florist' },
  '악기,피아노': { primary: 'shopping' },
  '가구, 침대': { primary: 'shopping', sub: 'furniture' },
  '사무기기': { primary: 'shopping' },
  '가전,주방기구': { primary: 'shopping', sub: 'electronics' },
  '서점': { primary: 'shopping', sub: 'bookstore' },
  '한복,이불': { primary: 'shopping', sub: 'clothing' },
  '결혼,출산,육아': { primary: 'shopping' },
  '문방구 미술재료': { primary: 'shopping' },
  '골동품,화랑,표구사': { primary: 'shopping' },
  '가발': { primary: 'beauty' },
  '의류,잡화': { primary: 'shopping', sub: 'clothing' },
  '어린이용품': { primary: 'shopping' },
  '구두, 신발': { primary: 'shopping', sub: 'clothing' },
  '여성의류': { primary: 'shopping', sub: 'clothing' },
  '남성의류': { primary: 'shopping', sub: 'clothing' },
  '골프용품': { primary: 'shopping' },
  '운동용품판매': { primary: 'shopping' },
  '전자 제품 판매,수리': { primary: 'shopping', sub: 'electronics' },
  '컴퓨터 용품, 수리': { primary: 'shopping', sub: 'electronics' },
  '셀룰러 폰': { primary: 'shopping', sub: 'electronics' },
  '컴퓨터수리/인터넷': { primary: 'shopping', sub: 'electronics' },
  '전화, 통신서비스': { primary: 'shopping', sub: 'electronics' },
  '전자': { primary: 'shopping', sub: 'electronics' },
  '비디오 대여': { primary: 'shopping' },
  '카메라 (판매,수리)': { primary: 'shopping', sub: 'electronics' },
  '전자제품 수리.설치': { primary: 'shopping', sub: 'electronics' },

  // ── Travel ──
  '관광, 숙박, 교통 서비스': { primary: 'travel' },
  '호텔,모텔,민박': { primary: 'travel', sub: 'hotel' },
  '항공사': { primary: 'travel', sub: 'airline' },
  '택시,리무진': { primary: 'travel' },
  '관광지': { primary: 'travel' },
  '관광명소': { primary: 'travel' },
  '놀이동산, 동물원': { primary: 'travel' },
  '박물관, 전시장': { primary: 'travel' },
  '국립.주립공원': { primary: 'travel' },
  '캠핑장': { primary: 'travel' },
  '낚시터': { primary: 'travel' },
  '스키장': { primary: 'travel' },
  '온천': { primary: 'travel' },
  '카지노': { primary: 'travel' },

  // ── Education ──
  '교육, 학원, 가정교사': { primary: 'education' },
  '학원(진학학습)': { primary: 'education', sub: 'tutoring' },
  '가정교사': { primary: 'education', sub: 'tutoring' },
  '미술학원': { primary: 'education' },
  '무용학원': { primary: 'education', sub: 'dance-school' },
  '컴퓨터학원': { primary: 'education' },
  '성인학교': { primary: 'education', sub: 'language-school' },
  '한국학교': { primary: 'education', sub: 'language-school' },
  '유아원,데이케어': { primary: 'education', sub: 'preschool' },
  '직업교육 대학, 어학원': { primary: 'education', sub: 'language-school' },
  '신학교': { primary: 'education' },
  '교통위반자 학교': { primary: 'education' },
  '유학서비스': { primary: 'education' },
  '초.중.고등학교': { primary: 'education' },
  '신학대학': { primary: 'education' },

  // ── Professional Services ──
  '전문 서비스 (이사, 인쇄등)': { primary: 'professional' },
  '통역.번역': { primary: 'professional', sub: 'translation' },
  '디자인': { primary: 'professional' },
  '판촉물,기념품': { primary: 'professional' },
  '간판, 네온사인': { primary: 'professional', sub: 'signage' },
  '인쇄,복사, 실크스크린': { primary: 'professional', sub: 'printing' },
  '사진, 비디오(현상,촬영)': { primary: 'professional', sub: 'photography' },
  '피아노조율': { primary: 'professional' },
  '구두수선': { primary: 'professional' },
  '결혼상담소': { primary: 'professional', sub: 'wedding' },
  '결혼관련서비스': { primary: 'professional', sub: 'wedding' },
  '파티전문': { primary: 'professional' },
  '장의사': { primary: 'professional', sub: 'funeral' },
  '운명 철학': { primary: 'professional' },
  '보안,시큐리티서비스': { primary: 'professional' },
  '소방설비,소화기': { primary: 'professional' },
  '직업소개소': { primary: 'professional' },
  '사설 탐정': { primary: 'professional' },
  '심부름 센터': { primary: 'professional' },
  '여권,비자': { primary: 'professional' },
  '웹사이트 제작': { primary: 'professional' },
  '프로그램 서비스': { primary: 'professional' },
  '호스팅': { primary: 'professional' },
  '전화, 인터넷, 컴퓨터': { primary: 'shopping', sub: 'electronics' },

  // ── Community ──
  '골프,스포츠,오락': { primary: 'community' },
  '골프장': { primary: 'community' },
  '골프렛슨': { primary: 'community' },
  '체육관': { primary: 'community' },
  '정신건강운동': { primary: 'community' },
  '당구장,탁구장,기원': { primary: 'community' },
  '스포츠 용품, 렛슨': { primary: 'community' },
  '만화방,도서대여': { primary: 'community' },
  'PC 방': { primary: 'community' },
  '노래방': { primary: 'community' },
  '지.상사, 한인사업체': { primary: 'professional' },
  '지.상사': { primary: 'professional' },
  '무역 및 도매': { primary: 'professional' },
  '비지니스': { primary: 'professional' },

  // ── Media ──
  '언론 및 방송': { primary: 'community', sub: 'media' },
  '방송사': { primary: 'community', sub: 'media' },
  '신문, 주간지': { primary: 'community', sub: 'media' },
  '기타언론사': { primary: 'community', sub: 'media' },
  '영화사, 프로덕션': { primary: 'community', sub: 'media' },

  // ── Religion ──
  '기독교': { primary: 'community', sub: 'church' },
  '교회(all)': { primary: 'community', sub: 'church' },
  '남침례회': { primary: 'community', sub: 'church' },
  '장로교': { primary: 'community', sub: 'church' },
  '감리교': { primary: 'community', sub: 'church' },
  '순복음': { primary: 'community', sub: 'church' },
  '성결교': { primary: 'community', sub: 'church' },
  '선교회': { primary: 'community', sub: 'church' },
  '기타 침례교': { primary: 'community', sub: 'church' },
  '재림교': { primary: 'community', sub: 'church' },
  '구세군': { primary: 'community', sub: 'church' },
  '성공회': { primary: 'community', sub: 'church' },
  '루터교': { primary: 'community', sub: 'church' },
  '천주교': { primary: 'community', sub: 'church' },
  '불교': { primary: 'community', sub: 'temple' },
  '원불교': { primary: 'community', sub: 'temple' },
  '통일교': { primary: 'community', sub: 'church' },
  '증산도': { primary: 'community' },
  '여호와의증인': { primary: 'community', sub: 'church' },
  '기도원': { primary: 'community', sub: 'church' },

  // ── Organizations ──
  '영사관,한인회,봉사단체': { primary: 'community', sub: 'organization' },
  '영사관,공공기관': { primary: 'community', sub: 'organization' },
  '봉사기관': { primary: 'community', sub: 'organization' },
  '한인회': { primary: 'community', sub: 'organization' },
  '노인회': { primary: 'community', sub: 'senior-center' },
  '응급연락처': { primary: 'community' },
  '예술,스포츠,동문,친목단체': { primary: 'community', sub: 'organization' },
  '합창,미술,예술단체': { primary: 'community', sub: 'organization' },
  '스포츠 단체': { primary: 'community', sub: 'organization' },
  '향우,종친회': { primary: 'community', sub: 'organization' },
  '연합회': { primary: 'community', sub: 'organization' },
  '동문회(중고등학교)': { primary: 'community', sub: 'organization' },
  '동문회(대학교)': { primary: 'community', sub: 'organization' },
  '동문회(US 대학교)': { primary: 'community', sub: 'organization' },
  '동문회(기타)': { primary: 'community', sub: 'organization' },
  '기타단체': { primary: 'community', sub: 'organization' },
  '연방.주정부': { primary: 'community', sub: 'organization' },
  '인물': { primary: 'community' },

  // ── Koreatown directories ──
  '뉴져지 한인타운': { primary: 'community' },
  '맨하탄 한인타운': { primary: 'community' },
  '산타클라라 한인타운': { primary: 'community' },
  '시카고 한인타운': { primary: 'community' },
  '아틀란타 한인타운': { primary: 'community' },
  '엘에이 한인타운': { primary: 'community' },
  '영국 뉴 멀든 한인타운': { primary: 'community' },
  '플러싱 한인타운': { primary: 'community' },
  '필라델피아 한인타운': { primary: 'community' },

  // === Shared simple categories (across multiple sources) ===
  '부동산': { primary: 'real-estate' },
  '모기지': { primary: 'financial', sub: 'mortgage-broker' },
  '보험': { primary: 'insurance' },
  '건축': { primary: 'home-services', sub: 'construction' },
  '자동차': { primary: 'auto' },
  '종교': { primary: 'community', sub: 'church' },
  '꽃집': { primary: 'shopping', sub: 'florist' },

  // === AU-specific categories (ikoreatown-au, woorimelbourne, kcmweekly) ===
  '청소용역': { primary: 'home-services', sub: 'cleaning' },
  '기타': { primary: 'community' },
  '학원': { primary: 'education', sub: 'tutoring' },
  '전기공사': { primary: 'home-services', sub: 'electrical' },
  '이삿짐센터': { primary: 'home-services', sub: 'moving' },
  '스포츠': { primary: 'community' },
  '교민단체': { primary: 'community', sub: 'organization' },
  '종교 (개신교)': { primary: 'community', sub: 'church' },
  '종교 (가톨릭)': { primary: 'community', sub: 'church' },
  '종교 (불교)': { primary: 'community', sub: 'temple' },
  '컴퓨터/POS': { primary: 'shopping', sub: 'electronics' },
  '학교/학원': { primary: 'education', sub: 'tutoring' },
  '건축 (핸디맨)': { primary: 'home-services', sub: 'construction' },
  '건축 (플러밍)': { primary: 'home-services', sub: 'plumbing' },
  '동문회': { primary: 'community', sub: 'organization' },
  '유치원': { primary: 'education', sub: 'preschool' },
  '번역/통역': { primary: 'professional', sub: 'translation' },
  '전자제품 (수리)': { primary: 'shopping', sub: 'electronics' },
  '주요한인기관': { primary: 'community', sub: 'organization' },
  '미용실': { primary: 'beauty', sub: 'hair-salon' },
  '치과': { primary: 'dental' },
  '한의원': { primary: 'medical', sub: 'korean-medicine' },
  '식당': { primary: 'food' },
  '마켓': { primary: 'food', sub: 'grocery' },
  '세탁소': { primary: 'home-services', sub: 'cleaning' },
  '인쇄': { primary: 'professional', sub: 'printing' },
  '카페': { primary: 'food', sub: 'cafe' },
  '베이커리': { primary: 'food', sub: 'bakery' },
  '태권도': { primary: 'education', sub: 'martial-arts' },
  '교회': { primary: 'community', sub: 'church' },
  '이사': { primary: 'home-services', sub: 'moving' },
  '페인팅': { primary: 'home-services', sub: 'painting' },
  '타일': { primary: 'home-services', sub: 'construction' },
  '카펫': { primary: 'home-services', sub: 'carpet' },
  '지붕': { primary: 'home-services', sub: 'roofing' },
  '전기': { primary: 'home-services', sub: 'electrical' },
  '배관': { primary: 'home-services', sub: 'plumbing' },
  '조경': { primary: 'home-services', sub: 'landscaping' },
  '간판': { primary: 'professional', sub: 'signage' },
  '웨딩': { primary: 'professional', sub: 'wedding' },
  '네일': { primary: 'beauty', sub: 'nail-salon' },
  '스파': { primary: 'beauty', sub: 'spa' },
  '화장품': { primary: 'beauty', sub: 'cosmetics' },
  '렌터카': { primary: 'auto', sub: 'car-rental' },
  '세차': { primary: 'auto', sub: 'car-wash' },
  '타이어': { primary: 'auto', sub: 'tires' },
  '토잉': { primary: 'auto', sub: 'towing' },
  '운전학원': { primary: 'education', sub: 'driving-school' },
  '음악학원': { primary: 'education', sub: 'music-school' },
  '댄스': { primary: 'education', sub: 'dance-school' },
};

// ─── Category ID cache ──────────────────────────────────────────────

interface CategoryCache {
  /** slug → { id, level } */
  bySlug: Map<string, { id: number; level: string }>;
  fallbackPrimaryId: number;
}

let _cache: CategoryCache | null = null;

/**
 * Load all categories from the database and cache them.
 * Must be called once before resolveCategory().
 */
export async function initCategoryCache(prisma: PrismaClient): Promise<CategoryCache> {
  if (_cache) return _cache;

  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, level: true },
  });

  const bySlug = new Map<string, { id: number; level: string }>();
  let fallbackPrimaryId = 0;

  for (const cat of categories) {
    bySlug.set(cat.slug, { id: cat.id, level: cat.level });
    // Use 'community' as fallback for unmapped categories
    if (cat.slug === 'community') {
      fallbackPrimaryId = cat.id;
    }
  }

  if (!fallbackPrimaryId) {
    // If no 'community' category, use the first primary
    const firstPrimary = categories.find(c => c.level === 'primary');
    if (firstPrimary) fallbackPrimaryId = firstPrimary.id;
    else throw new Error('No primary categories found in database');
  }

  _cache = { bySlug, fallbackPrimaryId };
  return _cache;
}

/**
 * Reset cache (for testing or re-initialization).
 */
export function resetCategoryCache(): void {
  _cache = null;
}

// ─── Resolve function ───────────────────────────────────────────────

export interface ResolvedCategory {
  primaryId: number;
  subId: number | null;
  mapped: boolean; // true if found in mapping, false if fallback
}

/**
 * Map a raw Korean category string to Category table IDs.
 *
 * @param rawCategory - The raw category string from StagedBusiness
 * @returns ResolvedCategory with primary (and optionally sub) category IDs
 */
export function resolveCategory(rawCategory: string | null): ResolvedCategory {
  if (!_cache) {
    throw new Error('Category cache not initialized. Call initCategoryCache() first.');
  }

  if (!rawCategory || !rawCategory.trim()) {
    return { primaryId: _cache.fallbackPrimaryId, subId: null, mapped: false };
  }

  const trimmed = rawCategory.trim();

  // 1. Direct lookup in the mapping
  const mapping = CRAWL_CATEGORY_MAPPING[trimmed];
  if (mapping) {
    const primary = _cache.bySlug.get(mapping.primary);
    const sub = mapping.sub ? _cache.bySlug.get(mapping.sub) : undefined;

    if (primary) {
      return {
        primaryId: primary.id,
        subId: sub?.id ?? null,
        mapped: true,
      };
    }
  }

  // 2. Try matching as a taxonomy slug directly (some StagedBusiness records
  //    may already have taxonomy slugs if the normalize step mapped them)
  const directSlug = _cache.bySlug.get(trimmed);
  if (directSlug) {
    if (directSlug.level === 'primary') {
      return { primaryId: directSlug.id, subId: null, mapped: true };
    }
    // It's a subcategory slug — we need to find its parent
    // For now, use the slug lookup to find the parent
    // Since we don't have parentId in cache, use fallback with the sub
    return { primaryId: _cache.fallbackPrimaryId, subId: directSlug.id, mapped: true };
  }

  // 3. Partial match: check if raw string contains a known key
  for (const [key, mapping] of Object.entries(CRAWL_CATEGORY_MAPPING)) {
    if (trimmed.includes(key) || key.includes(trimmed)) {
      const primary = _cache.bySlug.get(mapping.primary);
      const sub = mapping.sub ? _cache.bySlug.get(mapping.sub) : undefined;
      if (primary) {
        return {
          primaryId: primary.id,
          subId: sub?.id ?? null,
          mapped: true,
        };
      }
    }
  }

  // 4. Fallback to 'community' primary
  return { primaryId: _cache.fallbackPrimaryId, subId: null, mapped: false };
}
