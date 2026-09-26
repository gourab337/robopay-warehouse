// Helper: computes pedersen(tote_id, job_id) exactly as the proof_of_delivery circuit does.
fn main(tote_id: Field, job_id: Field) -> pub Field {
    std::hash::pedersen_hash([tote_id, job_id])
}
